// Step 11: final audit regression tests (hostname validation fix, one risk scale everywhere, risk engine validation,
// detection spot-check guard rails, release metadata). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const fc = require("fast-check");
const urlIntel = require("../src/shared/url-intel.js");
const engine = require("../src/shared/risk-engine.js");
const rules = require("../src/shared/risk-rules.js");
const detection = require("../scripts/detection-check.js");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

// ------------------------------------------------------------------ security fix: impossible host names
test("FIX: host names that no real website can have are refused, not rated Low", () => {
  for (const bad of ["ht!tp://:::", "http://-bad-.com", "http://bad-.com", "http://a..com", "http://exa$mple.com", "http://x_-.com"]) {
    const r = urlIntel.analyzeUrl(bad);
    assert.equal(r.ok, false, bad + " was accepted as " + (r.level || ""));
  }
  for (const site of [{ hostname: "-bad-.com", protocol: "https:" }, { hostname: "bad-.example", protocol: "http:" }]) assert.equal(urlIntel.analyzeSite(site).ok, false, site.hostname);
});

test("FIX: ordinary names, underscores, international names, IPv4 and IPv6 still work", () => {
  for (const good of ["https://www.sbi.co.in/", "https://my_host.example.com", "https://a-b.example.in", "https://xn--pple-43d.com/", "https://\u092a\u0947\u091f\u0940\u090f\u092e.com/", "http://103.21.58.4/", "http://[::1]/", "http://[2001:db8::1]/", "localhost:8080"]) {
    assert.equal(urlIntel.analyzeUrl(good).ok, true, good);
  }
});

// ------------------------------------------------------------------ one risk scale on every screen
test("FIX: the popup and the link checker show the central engine's category, not the URL analyzer's own level", () => {
  const popup = strip(read("src/popup/popup.js"));
  const dash = strip(read("src/dashboard/dashboard.js"));
  for (const [name, code] of [["popup.js", popup], ["dashboard.js", dash]]) {
    assert.doesNotMatch(code, /setRiskPill\([^)]*result\.level/, name + " still shows the URL analyzer's own level");
    assert.match(code, /setCategoryPill\(/, name);
  }
  assert.match(dash, /urlSummaryFor\(category\)/);
  assert.match(popup, /urlSummaryFor\(assessment\.category\)/);
});

// ------------------------------------------------------------------ risk engine validation
const ind = (id, weight, extra) => Object.assign({ id, label: "Sign " + id, why: "Because " + id, weight }, extra || {});

test("engine: one fixture per category, with the configured thresholds unchanged", () => {
  assert.deepEqual(rules.CATEGORIES.map((c) => [c.id, c.min, c.max]), [["LOW", 0, 24], ["MEDIUM", 25, 49], ["HIGH", 50, 74], ["CRITICAL", 75, 100]]);
  const cases = [
    ["LOW", { message: { ok: true, indicators: [] } }],
    ["MEDIUM", { message: { ok: true, indicators: [ind("a", 3)] } }],
    ["HIGH", { message: { ok: true, indicators: [ind("a", 4), ind("b", 4)] } }],
    ["CRITICAL", { message: { ok: true, indicators: [ind("a", 3, { critical: true })] } }],
    ["INCONCLUSIVE", { message: { ok: false } }],
    ["INCONCLUSIVE", { screenshot: { unavailable: true, reason: "No readable text was found in the image." } }],
    ["NOT_SCANNED", undefined],
  ];
  for (const [want, input] of cases) {
    const a = engine.assess(input);
    assert.equal(a.category, want, JSON.stringify(input));
    if (want === "INCONCLUSIVE" || want === "NOT_SCANNED") assert.equal(a.score, null);
    else assert.ok(a.score >= 0 && a.score <= 100);
  }
});

test("engine: the same evidence from two checkers is counted once", () => {
  const one = engine.assess({ message: { ok: true, indicators: [ind("otp_request", 5), ind("urgency", 2)] } });
  const twice = engine.assess({ message: { ok: true, indicators: [ind("otp_request", 5), ind("urgency", 2), ind("otp_request", 5)] }, screenshot: { ok: true, indicators: [ind("otp_request", 5)] } });
  assert.equal(twice.score, one.score);
  assert.equal(twice.evidence.filter((e) => e.id === "otp_request").length, 1);
});

test("engine: missing, failed or not-built checkers never lower the risk", () => {
  const base = { message: { ok: true, indicators: [ind("a", 4), ind("b", 3)] } };
  const s = engine.assess(base).score;
  for (const extra of [{ url: undefined }, { url: null }, { url: { ok: false } }, { payment: { unavailable: true, reason: "x" } }, { community: { ok: true, indicators: [ind("c", -12)] } }, { screenshot: "garbage" }]) {
    assert.equal(engine.assess(Object.assign({}, base, extra)).score, s, JSON.stringify(extra));
  }
});

test("engine: reasons and evidence come only from the indicators given; nothing claims a probability", () => {
  fc.assert(
    fc.property(fc.array(fc.record({ id: fc.stringMatching(/^[a-z_]{1,12}$/), weight: fc.double({ min: -12, max: 12, noNaN: true }), critical: fc.boolean() }), { maxLength: 15 }), (raw) => {
      const indicators = raw.map((r) => ind(r.id, r.weight, { critical: r.critical }));
      const a = engine.assess({ message: { ok: true, indicators } });
      assert.ok(a.score === null || (a.score >= 0 && a.score <= 100 && Number.isInteger(a.score)));
      const labels = new Set(indicators.map((i) => i.label));
      for (const r of a.reasons) assert.ok(labels.has(r.text));
      for (const e of a.evidence) assert.ok(labels.has(e.label));
      if (indicators.every((i) => !(i.weight > 0))) assert.equal(a.reasons.length, 0);
      const words = JSON.stringify([a.actions, a.reasons, a.confidence]);
      assert.doesNotMatch(words, /\d+\s*%|probability of|chance of fraud|guaranteed/i);
      assert.match(a.scoreMeaning, /not the probability/);
    }),
    { numRuns: 300 }
  );
});

test("engine: every checker in the background worker is scored by the one engine", () => {
  const handler = strip(read("src/background/handler.js"));
  const calls = handler.match(/riskEngine\.assess\(/g) || [];
  assert.ok(calls.length >= 6, "expected the URL, message, UPI and screenshot paths to call riskEngine.assess, found " + calls.length);
  for (const f of ["src/shared/message-scan.js", "src/shared/upi-analyze.js", "src/shared/screenshot.js"]) {
    assert.doesNotMatch(strip(read(f)), /\bscore\s*=|categoryOf\(|riskRules|SCORE_CURVE|pointsToScore/, f + " should only produce indicators (scam types are fine, risk scores are not)");
  }
});

// ------------------------------------------------------------------ detection spot-check guard rails
// These are not accuracy claims (see scripts/detection-check.js). They stop silent regressions:
//   - no ordinary or legitimate example may start raising a warning
//   - no new scam example may start being missed (the known misses are listed and reported)
const KNOWN_MISSES = ["message job scam"];

test("detection spot-check: no false positives on the legitimate and ordinary examples", () => {
  const { rows } = detection.run();
  const fp = rows.filter((r) => r.verdict === "FALSE POSITIVE" || /^NOT LOW/.test(r.verdict)).map((r) => r.kind + " " + r.group + ": " + r.input);
  assert.deepEqual(fp, []);
});

test("detection spot-check: the only missed scams are the known, reported ones", () => {
  const { rows } = detection.run();
  const misses = rows.filter((r) => r.verdict === "FALSE NEGATIVE" || /^MISS/.test(r.verdict)).map((r) => r.kind + " " + r.group);
  for (const m of misses) assert.ok(KNOWN_MISSES.includes(m), "new miss: " + m);
});

test("detection spot-check: an unfamiliar UPI ID on an ordinary payment is not called a scam", () => {
  const row = detection.run().rows.find((r) => r.group === "unfamiliar ID, ordinary payment");
  assert.equal(row.outcome.category, "LOW");
});

// ------------------------------------------------------------------ release metadata
test("release: the manifest and pages no longer describe the extension as an unfinished Step 1", () => {
  const manifest = JSON.parse(read("manifest.json"));
  assert.doesNotMatch(manifest.description, /step|no scam detection|foundation/i);
  assert.ok(manifest.description.length <= 132);
  assert.doesNotMatch(read("src/popup/popup.html"), /arrives in the next step/);
  assert.doesNotMatch(read("src/dashboard/dashboard.html"), /preliminary ratings based on the web address alone/);
  assert.doesNotMatch(JSON.parse(read("package.json")).description, /Step 1/);
});

test("release: documentation exists and states the privacy model and the limits honestly", () => {
  const readme = read("README.md");
  const demo = read("DEMO_GUIDE.md");
  for (const doc of [readme, demo]) {
    assert.match(doc, /storage/);
    assert.match(doc, /Load unpacked/);
    assert.match(doc, /[Kk]nown limitations/);
    assert.doesNotMatch(doc, /100% (accurate|detection)|detects all scams|guarantee(s|d)? (your )?safety/i);
  }
  assert.match(demo, /test data only/i);
});

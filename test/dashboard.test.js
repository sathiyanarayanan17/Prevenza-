// Step 10: unified dashboard (aggregate counters, RECORD_SCAN, the unified result summary, navigation, no second engine).
// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../src/shared/constants.js");
const S = require("../src/shared/settings.js");
const { createStore } = require("../src/shared/storage.js");
const { createBackground } = require("../src/background/handler.js");
const { createFakeArea } = require("./helpers/fake-chrome.js");
const RR = require("../src/shared/risk-result.js");
const engine = require("../src/shared/risk-engine.js");
const urlIntel = require("../src/shared/url-intel.js");
const messageScan = require("../src/shared/message-scan.js");
const upiAnalyze = require("../src/shared/upi-analyze.js");
const screenshot = require("../src/shared/screenshot.js");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const MSG = C.MSG;
const ID = "abcdefghijklmnopabcdefghijklmnop";
const PAGE = { id: ID, url: "chrome-extension://" + ID + "/src/dashboard/dashboard.html", tab: { id: 4 } };
const CONTENT = { id: ID, url: "https://shop.example/page", tab: { id: 3 } };
const OTHER = { id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", url: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/x.html" };

function setup(extra) {
  const area = createFakeArea();
  const store = createStore(area, () => "2026-11-17T10:00:00.000Z");
  const bg = createBackground(Object.assign({ store, runtimeId: ID, version: "0.1.0", urlIntel, messageScan, riskEngine: engine, upiAnalyze, screenshot }, extra || {}));
  return { area, store, bg };
}
const record = (category) => ({ type: MSG.RECORD_SCAN, payload: { category } });

// ------------------------------------------------------------------ aggregate counters
test("stats keep only counters and times; the new scan counters start at zero and are bounded", () => {
  const out = S.sanitizeStats({ scansTotal: 3, scansHigh: -1, scansLow: 2.5, scansCritical: "9", scansMedium: 1e12, lastScanAt: "nope", url: "https://x.test", message: "otp 1234", upiId: "a@ybl" });
  assert.equal(out.scansTotal, 3);
  assert.equal(out.scansHigh, 0);
  assert.equal(out.scansLow, 0);
  assert.equal(out.scansCritical, 0);
  assert.equal(out.scansMedium, C.LIMITS.maxCounter);
  assert.equal(out.lastScanAt, null);
  for (const k of ["url", "message", "upiId"]) assert.ok(!(k in out), k);
  for (const [k, v] of Object.entries(out)) assert.ok(typeof v === "number" || v === null || typeof v === "string", k);
  assert.deepEqual(Object.keys(S.SCAN_COUNTERS).sort(), ["CRITICAL", "HIGH", "INCONCLUSIVE", "LOW", "MEDIUM"]);
});

test("recordScan counts one check by category, plus a total and the time; anything else is ignored", async () => {
  const { store } = setup();
  for (const c of ["LOW", "MEDIUM", "HIGH", "CRITICAL", "INCONCLUSIVE", "HIGH"]) await store.recordScan(c);
  for (const bad of ["NOT_SCANNED", "low", "", null, undefined, 5, {}, "__proto__", "toString", "constructor", "hasOwnProperty"]) await store.recordScan(bad);
  const s = await store.getStats();
  assert.equal(s.scansTotal, 6);
  assert.deepEqual([s.scansLow, s.scansMedium, s.scansHigh, s.scansCritical, s.scansInconclusive], [1, 1, 2, 1, 1]);
  assert.equal(s.lastScanAt, "2026-11-17T10:00:00.000Z");
});

test("resetting statistics clears the scan counters too", async () => {
  const { store } = setup();
  await store.recordScan("HIGH");
  const s = await store.resetStats();
  assert.equal(s.scansTotal, 0);
  assert.equal(s.scansHigh, 0);
  assert.equal(s.lastScanAt, null);
});

// ------------------------------------------------------------------ RECORD_SCAN message
test("RECORD_SCAN: an extension page may count a category; content scripts and other extensions may not", async () => {
  const { bg, store } = setup();
  const r = await bg.handle(record("CRITICAL"), PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.stats.scansCritical, 1);
  assert.equal((await bg.handle(record("HIGH"), CONTENT)).error, "not-allowed");
  assert.equal((await bg.handle(record("HIGH"), OTHER)).error, "not-allowed");
  assert.equal((await bg.handle(record("HIGH"), undefined)).error, "not-allowed");
  assert.equal((await store.getStats()).scansTotal, 1);
});

test("RECORD_SCAN: accepts exactly { category } with a known category, nothing else", async () => {
  const { bg, store } = setup();
  const bad = [
    undefined, null, "HIGH", [], {}, { category: "NOT_SCANNED" }, { category: "high" }, { category: 3 }, { category: ["HIGH"] },
    { category: "__proto__" }, { category: "toString" }, { category: "HIGH", url: "https://x.test" }, { category: "HIGH", text: "otp 1234" },
    { category: "HIGH", upiId: "a@ybl" }, { cat: "HIGH" },
  ];
  for (const payload of bad) assert.equal((await bg.handle({ type: MSG.RECORD_SCAN, payload }, PAGE)).error, "bad-payload", JSON.stringify(payload));
  assert.equal((await store.getStats()).scansTotal, 0);
});

test("RECORD_SCAN: nothing is counted while protection is off", async () => {
  const { bg, store } = setup();
  await bg.handle({ type: MSG.UPDATE_SETTINGS, payload: { settings: { enabled: false } } }, PAGE);
  const r = await bg.handle(record("HIGH"), PAGE);
  assert.equal(r.skipped, "protection-off");
  assert.equal((await store.getStats()).scansTotal, 0);
});

test("RECORD_SCAN: without a store that can count, it says unavailable instead of pretending", async () => {
  const area = createFakeArea();
  const real = createStore(area);
  const store = Object.assign({}, real, { recordScan: undefined });
  const bg = createBackground({ store, runtimeId: ID, version: "0.1.0" });
  assert.equal((await bg.handle(record("HIGH"), PAGE)).error, "unavailable");
});

test("checking and counting together store no content: only counters, settings and the schema number", async () => {
  const { bg, area } = setup();
  const marker = "zq9-private-447";
  const replies = [
    await bg.handle({ type: MSG.CHECK_URL, payload: { url: "http://sbi-kyc-update.xyz/" + marker } }, PAGE),
    await bg.handle({ type: MSG.SCAN_MESSAGE, payload: { text: "Share your OTP now " + marker } }, PAGE),
    await bg.handle({ type: MSG.ANALYZE_UPI, payload: { upiId: marker + "@ybl", name: "Zq9 Person", amount: "4471", reason: "refund " + marker } }, PAGE),
    await bg.handle({ type: MSG.ANALYZE_SCREENSHOT, payload: { text: "Payment successful " + marker, confidence: 90 } }, PAGE),
  ];
  for (const r of replies) {
    const a = r.assessment || r.result.assessment;
    assert.equal((await bg.handle(record(a.category), PAGE)).ok, true);
  }
  const stored = JSON.stringify(area.data);
  for (const s of [marker, "Zq9", "4471", "sbi-kyc", "ybl", "OTP"]) assert.ok(!stored.includes(s), s);
  assert.deepEqual(Object.keys(area.data).sort(), ["prevenza.stats"].concat(Object.keys(area.data).filter((k) => k !== "prevenza.stats")).sort());
  for (const k of Object.keys(area.data)) assert.ok(["prevenza.schema", "prevenza.settings", "prevenza.stats"].includes(k), k);
  const stats = area.data["prevenza.stats"];
  assert.equal(stats.scansTotal, 4);
  for (const [k, v] of Object.entries(stats)) assert.ok(typeof v === "number" || v === null || /^\d{4}-\d\d-\d\dT/.test(v), k + "=" + v);
});

// ------------------------------------------------------------------ unified result summary (pure part)
const sample = (input) => engine.assess(input, { now: () => "2026-11-17T00:00:00.000Z" });

test("summary: every category is supported, and the score comes from the engine unchanged", () => {
  const cases = {
    LOW: sample({ url: { ok: true, indicators: [] } }),
    MEDIUM: sample({ url: { ok: true, indicators: [{ id: "a", label: "A", weight: 3 }] } }),
    HIGH: sample({ message: { ok: true, indicators: [{ id: "a", label: "A", weight: 4 }, { id: "b", label: "B", weight: 4 }] } }),
    CRITICAL: sample({ message: { ok: true, indicators: [{ id: "otp_x", label: "OTP request", weight: 5, critical: true }] } }),
    INCONCLUSIVE: sample({ screenshot: { unavailable: true, reason: "No readable text was found in the image." } }),
    NOT_SCANNED: sample(undefined),
  };
  for (const [want, a] of Object.entries(cases)) {
    assert.equal(a.category, want, "fixture " + want);
    const m = RR.model(a);
    assert.equal(m.category, want);
    if (typeof a.score === "number" && want !== "INCONCLUSIVE" && want !== "NOT_SCANNED") {
      assert.equal(m.score, a.score);
      assert.equal(m.scoreText, "Warning level " + a.score + " of 100");
      assert.equal(m.notSafe, "");
    } else {
      assert.equal(m.score, null);
      assert.match(m.scoreText, /^No warning level/);
      assert.match(m.notSafe, /Nothing was marked safe/);
    }
    assert.equal(m.action, a.recommendedAction);
    assert.match(m.confidence, /^(High|Medium|Low|None)/);
  }
  assert.equal(RR.model(cases.NOT_SCANNED).countable, false);
  assert.equal(RR.model(cases.INCONCLUSIVE).countable, true);
});

test("summary: missing or unreadable assessments are NOT SCANNED, never LOW", () => {
  for (const bad of [undefined, null, 5, "HIGH", [], {}, { category: "SAFE" }, { category: "LOW" /* no score */ }]) {
    const m = RR.model(bad);
    assert.notEqual(m.scoreText.indexOf("Warning level"), 0, JSON.stringify(bad));
    assert.match(m.notSafe, /Nothing was marked safe/);
  }
  assert.equal(RR.model(undefined).category, "NOT_SCANNED");
  assert.equal(RR.model({ category: "SAFE" }).category, "NOT_SCANNED");
});

test("summary: evidence comes only from the engine's reasons; a clean LOW says it is not proof of safety", () => {
  const low = RR.model(sample({ url: { ok: true, indicators: [] } }));
  assert.match(low.evidence, /not proof of safety/);
  assert.equal(low.evidenceCount, 0);
  const a = sample({ message: { ok: true, indicators: [{ id: "a", label: "Asks for OTP", weight: 4 }, { id: "b", label: "Urgent tone", weight: 3 }] } });
  const m = RR.model(a);
  assert.equal(m.evidenceCount, a.reasons.length);
  for (const r of a.reasons.slice(0, 3)) assert.ok(m.evidence.includes(r.text), r.text);
  assert.ok(!/Urgent tone|Asks for OTP/.test(low.evidence));
});

test("summary: a module that failed is listed as 'could not be checked'; 'not checked' and 'not built yet' are not", () => {
  const a = sample({ message: { ok: false }, url: { ok: true, indicators: [{ id: "a", label: "A", weight: 3 }] } });
  const m = RR.model(a);
  assert.equal(m.unavailable.length, 1);
  assert.match(m.unavailable[0], /^Message text: /);
  const i = RR.model(sample({ screenshot: { unavailable: true, reason: "No readable text was found in the image." } }));
  assert.deepEqual(i.unavailable, ["Screenshot text: No readable text was found in the image."]);
});

test("problemText never suggests safety", () => {
  for (const reply of [{ ok: false, error: "unavailable" }, { ok: false, error: "timeout" }, { ok: false, error: "x" }, null, undefined]) {
    const t = RR.problemText(reply);
    assert.match(t, /nothing was checked|Nothing was marked safe/i);
    assert.doesNotMatch(t.replace(/does not mean it is safe|Nothing was marked safe/g, ""), /\bsafe\b/i);
  }
  assert.match(RR.problemText({ ok: false, error: "unavailable" }), /not available right now/);
});

// ------------------------------------------------------------------ one engine only
test("there is exactly one risk scoring engine: no other file computes scores, categories or thresholds", () => {
  const src = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (e.name.endsWith(".js")) src.push({ rel: path.relative(root, full).split(path.sep).join("/"), code: strip(fs.readFileSync(full, "utf8")) });
    }
  };
  walk(path.join(root, "src"));
  const defines = (re) => src.filter((f) => re.test(f.code)).map((f) => f.rel);
  assert.deepEqual(defines(/function\s+assess\s*\(/), ["src/shared/risk-engine.js"]);
  assert.deepEqual(defines(/function\s+categoryOf\s*\(/), ["src/shared/risk-engine.js"]);
  assert.deepEqual(defines(/function\s+pointsToScore\s*\(/), ["src/shared/risk-engine.js"]);
  assert.deepEqual(defines(/SCORE_CURVE\s*=/), ["src/shared/risk-rules.js"]);
  // pages call the engine only in the background worker; dashboard scripts never call assess()
  for (const f of src.filter((x) => x.rel.startsWith("src/dashboard/") || x.rel === "src/shared/risk-result.js")) {
    assert.doesNotMatch(f.code, /riskEngine\.assess|\.assess\(/, f.rel);
    assert.doesNotMatch(f.code, /score\s*(>=|<=|>|<)\s*\d/, f.rel + " compares a score with a number (a second threshold)");
  }
});

// ------------------------------------------------------------------ the dashboard page
test("dashboard: the menu links to the existing checkers and Emergency Help, and each target exists", () => {
  const html = read("src/dashboard/dashboard.html");
  const cards = [...html.matchAll(/<a class="tool-card[^"]*" href="([^"]+)"(?: data-target="([^"]+)")?/g)].map((m) => ({ href: m[1], target: m[2] }));
  assert.deepEqual(cards.map((c) => c.href), ["#link-check", "#message-check", "#upi-check", "#screenshot-check", "../emergency/emergency.html"]);
  for (const c of cards.slice(0, 4)) {
    assert.match(html, new RegExp('id="' + c.href.slice(1) + '"'), c.href);
    assert.match(html, new RegExp('id="' + c.target + '"'), c.target);
  }
  assert.ok(fs.existsSync(path.join(root, "src/emergency/emergency.html")));
  // every checker ends with a way back to the menu
  for (const id of ["link-result", "msg-result", "upi-result", "shot-result"]) {
    assert.match(html, new RegExp('id="' + id + '"[^>]*></div>\\s*<p class="back-row"><a class="back-link" href="#tools-nav"'), id);
  }
  // icons are decorative and always next to words
  for (const m of html.matchAll(/<span class="(tool-icon|stat-icon)"([^>]*)>/g)) assert.match(m[2], /aria-hidden="true"/);
  // one copy of each checker: the steps 2 to 6 sections exist exactly once
  for (const id of ["link-check", "message-check", "upi-check", "screenshot-check", "link-form", "msg-form", "upi-form", "shot-file"]) {
    assert.equal((html.match(new RegExp('id="' + id + '"', "g")) || []).length, 1, id);
  }
});

test("dashboard: the overview shows the counters, says what is never saved, and points to reset", () => {
  const html = read("src/dashboard/dashboard.html");
  for (const id of ["stat-protection", "stat-scans", "stat-high", "stat-lowmed", "stat-inconclusive", "stat-lastscan", "stat-pages"]) assert.match(html, new RegExp('id="' + id + '"'), id);
  assert.match(html, /never saves what you checked: no links, messages, images, UPI IDs, names or amounts/);
  assert.match(html, /href="\.\.\/settings\/settings\.html#reset-stats"/);
  assert.match(read("src/settings/settings.html"), /id="reset-stats"/);
  const js = read("src/dashboard/dashboard.js");
  assert.match(js, /"Unavailable"/, "unreadable counters show 'Unavailable', not a made-up number");
  // the dashboard loads the summary before the checkers that use it
  const order = ["risk-result.js", "dashboard.js", "message-check.js", "upi-check.js", "screenshot-check.js"].map((f) => html.indexOf(f));
  assert.ok(order.every((v, i) => v > 0 && (i === 0 || v > order[i - 1])), order.join(","));
});

test("dashboard: every checker uses the shared summary and counts the result (category only)", () => {
  for (const f of ["src/dashboard/dashboard.js", "src/dashboard/message-check.js", "src/dashboard/upi-check.js", "src/dashboard/screenshot-check.js"]) {
    const code = strip(read(f));
    assert.match(code, /H\.riskResult\.render\(/, f);
    assert.match(code, /H\.riskResult\.record\(/, f);
    assert.match(code, /H\.riskResult\.problemText\(reply\)/, f);
  }
  const rr = strip(read("src/shared/risk-result.js"));
  assert.match(rr, /payload: \{ category: m\.category \}/);
  assert.doesNotMatch(rr, /chrome\.storage|localStorage|indexedDB/);
});

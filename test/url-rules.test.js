// Step 2: the configurable rule data must be clean and self-consistent. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const R = require("../src/shared/url-rules.js");
const U = require("../src/shared/url-intel.js");

const DOMAIN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/;

function noDuplicates(list, name) {
  assert.equal(new Set(list).size, list.length, name + " has duplicates");
}

test("rule lists are lowercase plain domains with no schemes or paths", () => {
  const lists = { SHORTENERS: R.SHORTENERS, FREE_HOSTS: R.FREE_HOSTS, MULTI_SUFFIXES: R.MULTI_SUFFIXES, RESTRICTED_SUFFIXES: R.RESTRICTED_SUFFIXES.filter((s) => s.includes(".")) };
  for (const [name, list] of Object.entries(lists)) {
    noDuplicates(list, name);
    for (const d of list) assert.match(d, DOMAIN, name + ": " + d);
  }
  for (const tld of R.SUSPICIOUS_TLDS) assert.match(tld, /^[a-z]{2,}$/, tld);
  noDuplicates(R.SUSPICIOUS_TLDS, "SUSPICIOUS_TLDS");
  noDuplicates(R.KEYWORDS, "KEYWORDS");
  for (const k of R.KEYWORDS) assert.equal(k, k.toLowerCase());
});

test("the rules are frozen so code cannot change them by accident", () => {
  for (const key of ["WEIGHTS", "THRESHOLDS", "LIMITS", "BRANDS", "SHORTENERS"]) assert.ok(Object.isFrozen(R[key]), key);
});

test("weights and thresholds are sensible numbers", () => {
  for (const [id, w] of Object.entries(R.WEIGHTS)) assert.ok(Number.isFinite(w), id);
  assert.ok(R.THRESHOLDS.medium > 0 && R.THRESHOLDS.high > R.THRESHOLDS.medium);
  assert.ok(R.WEIGHTS.known_official < 0 && R.WEIGHTS.restricted_suffix < 0);
  assert.equal(R.WEIGHTS.local_address, 0);
  assert.ok(R.WEIGHTS.no_https < R.THRESHOLDS.medium, "plain http must never be a warning on its own");
  assert.ok(R.WEIGHTS.suspicious_tld < R.THRESHOLDS.medium, "a risky ending must not be a warning on its own");
  assert.ok(R.WEIGHTS.keywords < R.THRESHOLDS.medium, "login-style words must not be a warning on their own");
  assert.ok(R.WEIGHTS.shortener >= R.THRESHOLDS.medium, "shorteners are MEDIUM");
});

test("every weight used by the engine exists in the rules", () => {
  const ids = ["homograph_mixed", "homograph_whole", "at_sign_domain", "brand_lookalike", "brand_in_subdomain", "brand_typosquat", "misleading_subdomain", "ip_public", "ip_ipv6", "ip_disguised", "brand_in_domain", "brand_with_keyword", "shortener", "credentials", "many_subdomains", "redirect_param", "at_in_path", "backslash", "suspicious_tld", "long_hostname", "many_hyphens", "free_hosting", "keywords", "idn", "unusual_port", "encoded_chars", "path_keywords", "no_https", "local_address", "known_official", "restricted_suffix"];
  for (const id of ids) assert.equal(typeof R.WEIGHTS[id], "number", "missing weight: " + id);
});

test("every famous-name entry is well formed", () => {
  const seen = new Set();
  for (const b of R.BRANDS) {
    assert.ok(b.id && b.name, "brand needs id and name");
    assert.ok(!seen.has(b.id), "duplicate brand id " + b.id);
    seen.add(b.id);
    assert.ok(Array.isArray(b.exact) && Array.isArray(b.contains) && Array.isArray(b.domains));
    assert.ok(b.exact.length + b.contains.length > 0, b.id + " has no names to look for");
    for (const t of [...b.exact, ...b.contains]) assert.match(t, /^[a-z0-9]+$/, b.id + " token " + t);
    for (const t of b.contains) assert.ok(t.length >= 6, b.id + ": 'contains' names must be 6+ letters to avoid false alarms: " + t);
    assert.ok(b.domains.length > 0, b.id);
    noDuplicates(b.domains, b.id + ".domains");
    for (const d of b.domains) assert.match(d, DOMAIN, b.id + " domain " + d);
  }
  assert.ok(R.BRANDS.length >= 20);
});

test("every real website on the list is itself LOW risk, with and without www or a login sub-site", () => {
  // If this fails, a real company would be wrongly warned about.
  for (const b of R.BRANDS) {
    for (const d of b.domains) {
      for (const host of [d, "www." + d, "login." + d]) {
        for (const scheme of ["https://", "http://"]) {
          const r = U.analyzeUrl(scheme + host + "/");
          assert.equal(r.ok, true, host);
          assert.equal(r.level, "low", `${host}: ${r.level} ${r.score} ${r.indicators.map((i) => i.id).join(",")}`);
        }
      }
    }
  }
});

test("the shorteners on the list are all MEDIUM", () => {
  for (const s of R.SHORTENERS) {
    assert.equal(U.analyzeUrl("https://" + s + "/abc").level, "medium", s);
  }
});

test("the free hosting list is treated as public endings (a name there belongs to its owner)", () => {
  for (const h of R.FREE_HOSTS) {
    const split = U.splitHost("someone." + h);
    assert.equal(split.registrable, "someone." + h, h);
  }
});

test("the limits are enforced", () => {
  assert.equal(R.LIMITS.maxInputLength, 2048);
  assert.equal(U.analyzeUrl("https://example.com/" + "x".repeat(R.LIMITS.maxInputLength)).error, "too-long");
});

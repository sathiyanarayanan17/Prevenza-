// Step 2: offline URL intelligence. Behaviour tests. Run with: npm test
// IMPORTANT: these example addresses were written by the project author. They check the rules do what they say.
// They are NOT a measure of real-world accuracy.
const test = require("node:test");
const assert = require("node:assert/strict");
const fc = require("fast-check");
const U = require("../src/shared/url-intel.js");
const R = require("../src/shared/url-rules.js");

const url = (s) => U.analyzeUrl(s);
const site = (hostname, protocol = "https:") => U.analyzeSite({ hostname, protocol });
const ids = (r) => r.indicators.map((i) => i.id);
const RANK = { low: 1, medium: 2, high: 3 };

function expectLevel(input, expected, mode = "url") {
  const r = mode === "site" ? site(input) : url(input);
  assert.equal(r.ok, true, input + " should be analysable: " + JSON.stringify(r));
  assert.equal(r.level, expected, `${input}: expected ${expected}, got ${r.level} (score ${r.score}: ${ids(r).join(", ")})`);
  return r;
}
function expectAtLeast(input, minimum) {
  const r = url(input);
  assert.equal(r.ok, true, input);
  assert.ok(RANK[r.level] >= RANK[minimum], `${input}: expected at least ${minimum}, got ${r.level} (${ids(r).join(", ")})`);
  return r;
}

// ------------------------------------------------------------------ 1. legitimate addresses

const LEGIT = [
  "https://www.onlinesbi.sbi/", "https://retail.onlinesbi.sbi/login", "https://sbi.co.in", "https://www.hdfcbank.com/personal/login",
  "https://netbanking.hdfcbank.com", "https://www.icicibank.com", "https://www.axisbank.com", "https://www.kotak.com", "https://paytm.com",
  "https://www.phonepe.com", "https://www.amazon.in/gp/cart", "https://www.flipkart.com", "https://www.google.com/search?q=sbi+kyc",
  "https://accounts.google.com/signin", "https://mail.google.com", "https://login.microsoftonline.com", "https://www.apple.com/in",
  "https://www.irctc.co.in/nget/train-search", "https://www.incometax.gov.in", "https://uidai.gov.in", "https://resident.uidai.gov.in",
  "https://www.rbi.org.in", "https://www.npci.org.in", "https://www.epfindia.gov.in", "https://www.whatsapp.com", "https://web.whatsapp.com",
  "https://www.facebook.com/login", "https://www.instagram.com", "https://www.netflix.com/in", "https://www.paypal.com/signin",
  "https://en.wikipedia.org/wiki/State_Bank_of_India", "https://www.thehindu.com", "https://timesofindia.indiatimes.com", "https://github.com/sbi",
  "https://www.zerodha.com", "https://groww.in", "https://www.makemytrip.com", "https://www.bookmyshow.com", "https://www.swiggy.com",
  "https://www.youtube.com/watch?v=abc", "https://www.gst.gov.in", "https://www.india.gov.in", "https://digilocker.gov.in",
  "https://pagead2.googlesyndication.com", "https://www.googletagmanager.com", "https://m.example.com/page", "https://example.com",
];

test("legitimate websites are LOW risk with no needless warnings", () => {
  for (const u of LEGIT) {
    const r = expectLevel(u, "low");
    assert.ok(r.score < R.THRESHOLDS.medium, u);
  }
});

test("real bank and government sites are recognised and explained", () => {
  const sbi = url("https://retail.onlinesbi.sbi/login");
  assert.ok(ids(sbi).includes("known_official"));
  assert.match(sbi.indicators[0].label, /SBI/);
  const gov = url("https://www.gst.gov.in");
  assert.ok(ids(gov).includes("restricted_suffix"));
});

test("plain http alone is not treated as a scam", () => {
  const r = expectLevel("http://example.com", "low");
  assert.deepEqual(ids(r), ["no_https"]);
  assert.ok(r.score <= 1);
});

test("HTTPS is never counted as proof of safety (it adds no credit)", () => {
  const secure = url("https://sbi-kyc-update.xyz");
  const plain = url("http://sbi-kyc-update.xyz");
  assert.equal(secure.level, "high");
  assert.ok(secure.score <= plain.score, "https must not lower or raise anything except removing the plain-http note");
  assert.ok(!ids(secure).some((id) => /https|secure|padlock/i.test(id)));
  assert.match(U.analyzeUrl("https://example.com").summary, /not prove/i);
});

test("LOW risk wording never claims the site is safe", () => {
  // The honest sentence "does not prove the site is safe" is allowed; any other claim of safety is not.
  const withoutNegation = U.SUMMARY.low.replace(/does not prove the site is safe/i, "");
  assert.doesNotMatch(withoutNegation, /\bis safe\b|\bsafe to use\b|\btrusted\b|\bsecure\b|\bgenuine\b/i);
  assert.match(U.SUMMARY.low, /does not prove/i);
});

// ------------------------------------------------------------------ 2. lookalike and brand impersonation

test("fake KYC and login sites that copy a famous name are HIGH", () => {
  for (const u of ["https://sbi-kyc-update.xyz", "https://hdfcbank-secure-login.com", "https://paytm-kyc-verify.in", "https://icicibank-login-update.top", "https://amazon-refund-claim.click", "https://irctc-ticket-refund.xyz"]) {
    const r = expectLevel(u, "high");
    assert.ok(ids(r).some((i) => i.startsWith("brand_")), u);
  }
});

test("a famous name placed in front of another site is HIGH", () => {
  for (const u of ["https://paytm.verify-now.in", "https://sbi.secure-login.com", "https://www.paytm.com.evil.xyz", "https://login.hdfcbank.com.update-account.net", "https://amazon.in.refund-help.com"]) {
    expectLevel(u, "high");
  }
  assert.ok(ids(url("https://www.paypal.com.evil.xyz")).includes("misleading_subdomain"));
});

test("one-letter misspellings of famous names are flagged", () => {
  for (const u of ["https://paytmm.com", "https://goggle.com", "https://amazom.in", "https://netfilx.com", "https://phonepee.com", "https://flipkrat.com"]) {
    const r = expectAtLeast(u, "medium");
    assert.ok(ids(r).includes("brand_typosquat"), u + " -> " + ids(r));
  }
});

test("look-alike letters and digits are flagged", () => {
  for (const u of ["https://paypa1.com", "https://amaz0n.in", "https://g00gle.com", "https://rnicrosoft.com", "https://paypa1-login.com"]) {
    const r = expectAtLeast(u, "high");
    assert.ok(ids(r).includes("brand_lookalike"), u);
  }
});

test("a famous name inside an unrelated address is MEDIUM at least, with a plain explanation", () => {
  const r = expectLevel("https://sbi-tutorials.com", "medium");
  assert.ok(ids(r).includes("brand_in_domain"));
  assert.match(r.indicators[0].why, /If you expected/);
});

test("words that merely look similar to a name are not flagged", () => {
  for (const u of ["https://kodak.com", "https://pineapple.com", "https://applepie.com", "https://axis.com", "https://sbibank-news.example.org".replace("sbibank", "stateguide"), "https://irctcfan.example.org".replace("irctcfan", "railfan")]) {
    expectLevel(u, "low");
  }
});

test("a free page on a hosting service that copies a name is flagged", () => {
  const r = expectAtLeast("https://sbi-kyc.vercel.app", "high");
  assert.ok(ids(r).includes("free_hosting"));
});

// ------------------------------------------------------------------ 3. shorteners

test("link shorteners are MEDIUM and explained", () => {
  for (const u of ["https://bit.ly/3xYzAb", "https://tinyurl.com/abc123", "https://t.co/xyz", "https://cutt.ly/abcd", "https://rb.gy/abc", "https://shorturl.at/abc", "http://goo.gl/abc", "https://ow.ly/a1b2", "https://is.gd/abc", "https://t.ly/abc"]) {
    const r = expectLevel(u, "medium");
    assert.ok(ids(r).includes("shortener"), u);
    assert.match(r.indicators[0].why, /destination|where|real address|anywhere/i);
  }
});

test("the shortener list can be configured", () => {
  assert.ok(Array.isArray(R.SHORTENERS) && R.SHORTENERS.length >= 15);
  assert.ok(R.SHORTENERS.every((s) => s === s.toLowerCase() && !s.includes("/")));
});

// ------------------------------------------------------------------ 4. IP addresses

test("public IP addresses are flagged; private ones are not", () => {
  const pub = expectAtLeast("http://203.0.113.9/login", "medium");
  assert.ok(ids(pub).includes("ip_public"));
  assert.equal(expectAtLeast("https://8.8.8.8/", "medium").level !== "low", true);
  for (const u of ["http://192.168.1.1/admin", "http://10.0.0.5:8080/", "http://127.0.0.1:3000", "http://172.16.4.2/", "http://localhost:3000/app", "http://[::1]/"]) {
    const r = expectLevel(u, "low");
    assert.ok(ids(r).includes("local_address"), u);
  }
});

test("disguised number addresses are still caught", () => {
  const dec = url("http://3640205644/"); // 217.12.223.12 written as one number
  assert.ok(ids(dec).includes("ip_public") && ids(dec).includes("ip_disguised"), JSON.stringify(ids(dec)));
  const hex = url("http://0xD90CDF0C/");
  assert.ok(ids(hex).includes("ip_public"), JSON.stringify(ids(hex)));
  const v6 = url("http://[2001:db8::1]/");
  assert.ok(ids(v6).includes("ip_ipv6"));
  assert.equal(v6.level, "medium");
});

// ------------------------------------------------------------------ 5. punycode and international names

test("punycode is decoded correctly", () => {
  assert.equal(U.punycodeDecode("h2brj9c"), "\u092D\u093E\u0930\u0924"); // Hindi "Bharat"
  assert.equal(U.punycodeDecode("pple-43d"), "\u0430pple"); // Cyrillic a + "pple"
  assert.equal(U.punycodeDecode("!!!"), null);
  assert.equal(U.punycodeDecode("a-"), "a");
});

test("mixed-alphabet and look-alike-letter names are HIGH", () => {
  const apple = expectLevel("https://xn--pple-43d.com", "high");
  assert.ok(ids(apple).includes("homograph_mixed"));
  assert.equal(apple.hostUnicode, "\u0430pple.com");
  const whole = expectLevel("https://xn--80ak6aa92e.com", "high"); // all-Cyrillic look-alike of "apple"
  assert.ok(ids(whole).includes("homograph_whole"));
  assert.ok(ids(url("https://paypál.com")).includes("homograph_whole"));
});

test("honest names in other languages are LOW, with a gentle note", () => {
  for (const u of ["https://xn--h2brj9c.xn--h2brj9c/", "https://xn--11b4c3d.xn--11b4c3d/", "https://xn--fiq228c.com"]) {
    const r = url(u);
    assert.equal(r.ok, true, u);
    assert.equal(r.level, "low", u + " " + ids(r));
    assert.ok(ids(r).includes("idn"), u);
  }
});

test("a broken punycode label does not crash", () => {
  const r = url("https://xn--.com");
  assert.equal(typeof r.ok, "boolean");
  const r2 = url("https://xn--zzzzzzzzzzzzzzzz.com");
  assert.equal(typeof r2.ok, "boolean");
});

// ------------------------------------------------------------------ 6. misleading structure

test("the @ trick is detected and the real site is named", () => {
  const r = url("https://sbi.co.in@evil.com/login");
  assert.equal(r.level, "high");
  assert.ok(ids(r).includes("at_sign_domain"));
  assert.equal(r.host, "evil.com");
  assert.match(r.indicators.find((i) => i.id === "at_sign_domain").why, /evil\.com/);
});

test("a username in an address is flagged, an @ in a normal path is only a note", () => {
  assert.ok(ids(url("https://user:pw@example.com")).includes("credentials"));
  const medium = url("https://medium.com/@someone/post");
  assert.equal(medium.level, "low");
  assert.ok(ids(medium).includes("at_in_path"));
  assert.ok(medium.score < R.THRESHOLDS.medium);
});

test("the backslash trick is flagged", () => {
  const r = url("https://evil.com\\@good.com/");
  assert.equal(r.host, "evil.com");
  assert.ok(ids(r).includes("backslash"));
  assert.equal(r.level, "medium");
});

test("long chains, many hyphens and risky endings add up but stay in proportion", () => {
  const chain = url("https://a.b.c.d.e.example.com");
  assert.ok(ids(chain).includes("many_subdomains"));
  assert.equal(chain.level, "low");
  const hy = url("https://secure-bank-login-update-now.com");
  assert.ok(ids(hy).includes("many_hyphens"));
  assert.ok(RANK[hy.level] >= RANK.low);
  assert.ok(ids(url("https://example.xyz")).includes("suspicious_tld"));
  assert.equal(url("https://example.xyz").level, "low", "a risky ending alone is not enough");
});

test("a redirect parameter and heavy encoding are noted for user-supplied links only", () => {
  assert.ok(ids(url("https://example.com/go?url=https://evil.xyz")).includes("redirect_param"));
  assert.ok(ids(url("https://example.com/a" + "%2F".repeat(10))).includes("encoded_chars"));
  assert.ok(ids(url("https://example.com:8443/x")).includes("unusual_port"));
  assert.equal(ids(url("https://example.com:443/x")).includes("unusual_port"), false);
  assert.equal(ids(site("example.com")).includes("redirect_param"), false);
});

test("login words in the path only matter when the address already looks wrong", () => {
  assert.equal(ids(url("https://example.com/login/verify")).includes("path_keywords"), false);
  assert.ok(ids(url("https://sbi-kyc-update.xyz/login")).includes("path_keywords"));
});

// ------------------------------------------------------------------ 7. malformed and unsupported input

test("malformed input returns a friendly error and never throws", () => {
  const bad = ["", "   ", "\n", "https://", "http:///x", "://x", "https://exa mple.com", "free offer http://x.com", "https://a..b", "https://-bad-.com", "http://[::1", "https://.com", "https://" + "a".repeat(70) + ".com", "https://" + "a.".repeat(200) + "com", "\u0000", "https://bad\u0007host.com", "https://%zz.com"];
  for (const input of bad) {
    let r;
    assert.doesNotThrow(() => (r = url(input)), JSON.stringify(input));
    assert.equal(typeof r.ok, "boolean");
    if (!r.ok) {
      assert.ok(typeof r.error === "string" && r.error.length > 0, JSON.stringify(input));
      assert.ok(typeof r.message === "string" && r.message.length > 8, JSON.stringify(input));
    }
  }
  assert.equal(url("").error, "empty");
  assert.equal(url("   ").error, "empty");
  assert.equal(url("https://exa mple.com").error, "invalid-characters");
});

test("non-text input is refused", () => {
  for (const input of [null, undefined, 42, {}, [], true, () => 1, Symbol("x")]) {
    const r = url(input);
    assert.equal(r.ok, false);
    assert.equal(r.error, "not-text");
  }
});

test("unsupported schemes are refused with a clear message", () => {
  for (const input of ["javascript:alert(1)", "JavaScript:alert(1)", "data:text/html,<b>x</b>", "file:///etc/passwd", "ftp://example.com/x", "mailto:a@b.com", "tel:+911234567890", "chrome://settings", "view-source:https://x.com", "blob:https://x.com/abc", "upi://pay?pa=a@b", "intent://x#Intent;end", "ws://example.com", "about:blank"]) {
    const r = url(input);
    assert.equal(r.ok, false, input);
    assert.equal(r.error, "unsupported-scheme", input);
    assert.match(r.message, /http/i);
  }
});

test("very long input is refused quickly", () => {
  const t0 = Date.now();
  const r = url("https://example.com/" + "a".repeat(5000));
  assert.equal(r.ok, false);
  assert.equal(r.error, "too-long");
  assert.ok(Date.now() - t0 < 50);
});

test("an address without a scheme is checked as https and says so", () => {
  const r = url("sbi-kyc-update.xyz/login");
  assert.equal(r.ok, true);
  assert.equal(r.assumedScheme, true);
  assert.equal(r.scheme, "https:");
  assert.equal(r.level, "high");
  assert.equal(url("https://example.com").assumedScheme, false);
});

test("analyzeSite accepts only a site name and protocol", () => {
  for (const input of [null, undefined, "x", 1, [], {}, { hostname: "a.com" }, { protocol: "https:" }, { hostname: 5, protocol: "https:" }, { hostname: "a.com", protocol: "ftp:" }, { hostname: "a.com", protocol: "javascript:" }, { hostname: "", protocol: "https:" }, { hostname: "a b.com", protocol: "https:" }, { hostname: "a.com/path", protocol: "https:" }, { hostname: "a".repeat(300) + ".com", protocol: "https:" }]) {
    const r = U.analyzeSite(input);
    assert.equal(r.ok, false, JSON.stringify(input));
    assert.equal(typeof r.message, "string");
  }
});

test("site and URL modes agree on the same host name", () => {
  for (const host of ["sbi-kyc-update.xyz", "retail.onlinesbi.sbi", "bit.ly", "paytm.verify-now.in", "example.com", "203.0.113.9"]) {
    assert.equal(site(host).level, url("https://" + host).level, host);
  }
});

// ------------------------------------------------------------------ 8. explanations and privacy of the result

test("every indicator is explained in plain language", () => {
  const samples = ["https://sbi-kyc-update.xyz/login?url=https://x.xyz", "https://xn--pple-43d.com", "https://sbi.co.in@evil.com", "https://bit.ly/x", "http://203.0.113.9:8080/", "https://paytm.com.evil.xyz", "https://goggle.com", "https://a.b.c.d.e.secure-bank-login-update.top", "https://sbi.vercel.app", "https://xn--h2brj9c.xn--h2brj9c"];
  const jargon = /homograph|homoglyph|punycode|\bTLD\b|\bDNS\b|\bregistrar\b|\bheuristic\b|\bIDN\b|\bhostname\b|\bsubdomain\b|\bregex\b/i;
  for (const s of samples) {
    const r = url(s);
    assert.equal(r.ok, true, s);
    assert.ok(r.indicators.length > 0, s);
    for (const i of r.indicators) {
      assert.ok(i.label.length > 5 && i.why.length > 20, s + " " + i.id);
      assert.doesNotMatch(i.label + " " + i.why, jargon, s + " " + i.id + " uses jargon: " + i.why);
      assert.ok(["high", "medium", "low", "info"].includes(i.severity));
    }
  }
});

test("results never contain the path, query, username or password of the address", () => {
  const r = url("https://user:SECRETPW@sbi-kyc-update.xyz/account/TOKEN123456?session=ABCDEF&otp=998877#frag");
  const text = JSON.stringify(r);
  for (const secret of ["SECRETPW", "TOKEN123456", "ABCDEF", "998877", "frag", "/account", "session=", "otp="]) {
    assert.ok(!text.includes(secret), "result leaks: " + secret);
  }
  assert.equal(r.host, "sbi-kyc-update.xyz");
});

test("results are ordered strongest first and scores add up", () => {
  const r = url("https://sbi-kyc-update.xyz/login");
  const positives = r.indicators.filter((i) => i.weight > 0).map((i) => i.weight);
  assert.deepEqual(positives, [...positives].sort((a, b) => b - a));
  const sum = Math.round(r.indicators.reduce((s, i) => s + i.weight, 0) * 10) / 10;
  assert.equal(r.score, Math.max(0, sum));
});

test("levels follow the configured thresholds", () => {
  assert.equal(R.THRESHOLDS.medium < R.THRESHOLDS.high, true);
  const r = url("https://bit.ly/x");
  assert.equal(r.score, 3);
  assert.equal(r.level, "medium");
});

// ------------------------------------------------------------------ helpers

test("helper functions behave", () => {
  assert.equal(U.editDistance("paytm", "paytmm"), 1);
  assert.equal(U.editDistance("paytm", "patym"), 1, "swapped letters count as one change");
  assert.equal(U.editDistance("paytm", "google") > 1, true);
  assert.equal(U.skeleton("paypa1"), "paypal");
  assert.equal(U.skeleton("\u0430pple"), "apple");
  assert.equal(U.skeleton("amaz0n"), "amazon");
  assert.deepEqual(U.splitHost("a.b.example.co.in").registrable, "example.co.in");
  assert.equal(U.splitHost("x.vercel.app").registrable, "x.vercel.app");
  assert.equal(U.splitHost("www.example.com").registrable, "example.com");
});

// ------------------------------------------------------------------ properties (random input)

test("PROPERTY: random text never crashes and always returns a well-formed result", () => {
  fc.assert(
    fc.property(fc.string({ unit: "binary", maxLength: 3000 }), (s) => {
      const r = U.analyzeUrl(s);
      if (typeof r.ok !== "boolean") return false;
      if (r.ok) return ["low", "medium", "high"].includes(r.level) && Number.isFinite(r.score) && r.score >= 0 && Array.isArray(r.indicators);
      return typeof r.error === "string" && typeof r.message === "string";
    }),
    { numRuns: 400 }
  );
});

test("PROPERTY: random objects given to analyzeSite never crash", () => {
  fc.assert(
    fc.property(fc.anything(), (x) => {
      const r = U.analyzeSite(x);
      return typeof r.ok === "boolean";
    }),
    { numRuns: 300 }
  );
});

test("PROPERTY: hostile address-like strings stay fast (under 20 ms)", () => {
  const parts = ["https://", "http://", "xn--", "-", ".", "@", "\\", "%2F", "a", "sbi", "paytm", "login", "0", "1", "[", "]", ":", "/", "?", "=", "&", "bit.ly", ".com", ".xyz", "com.", "co.in"];
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...parts), { maxLength: 400 }), (arr) => {
      const t0 = process.hrtime.bigint();
      U.analyzeUrl(arr.join(""));
      return Number(process.hrtime.bigint() - t0) / 1e6 < 20;
    }),
    { numRuns: 300 }
  );
});

test("PROPERTY: ordinary words and ordinary endings are always LOW (no excessive warnings)", () => {
  const words = ["lake", "mango", "river", "stone", "garden", "cotton", "silver", "maple", "harbor", "tulip", "bridge", "violet"];
  const endings = [".com", ".in", ".org", ".net", ".co.in", ".info"];
  fc.assert(
    fc.property(fc.array(fc.constantFrom(...words), { minLength: 1, maxLength: 2 }), fc.constantFrom(...endings), fc.constantFrom("http://", "https://"), (w, end, scheme) => {
      const r = U.analyzeUrl(scheme + w.join("-") + end);
      return r.ok && r.level === "low";
    }),
    { numRuns: 300 }
  );
});

test("PROPERTY: switching http to https never raises the score", () => {
  const hosts = ["sbi-kyc-update.xyz", "bit.ly", "example.com", "203.0.113.9", "paytm.verify-now.in", "xn--pple-43d.com"];
  fc.assert(
    fc.property(fc.constantFrom(...hosts), (h) => U.analyzeUrl("https://" + h).score <= U.analyzeUrl("http://" + h).score),
    { numRuns: 60 }
  );
});

test("PROPERTY: the result is the same every time (deterministic)", () => {
  fc.assert(
    fc.property(fc.string({ maxLength: 200 }), (s) => JSON.stringify(U.analyzeUrl(s)) === JSON.stringify(U.analyzeUrl(s))),
    { numRuns: 150 }
  );
});

// Step 12: the full-page warning before a website whose name has strong scam signs. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const C = require("../src/shared/constants.js");
const urlIntel = require("../src/shared/url-intel.js");
const riskEngine = require("../src/shared/risk-engine.js");
const { createStore } = require("../src/shared/storage.js");
const { createBackground, MESSAGE_POLICY } = require("../src/background/handler.js");
const { createFakeArea } = require("./helpers/fake-chrome.js");

const MSG = C.MSG;
const ID = "abcdefghijklmnopabcdefghijklmnop";
const tab = (host, scheme) => ({ id: ID, url: (scheme || "https://") + host + "/some/page?x=1", tab: { id: 7, url: (scheme || "https://") + host + "/some/page?x=1" } });
const PAGE = { id: ID, url: "chrome-extension://" + ID + "/src/dashboard/dashboard.html" };
const check = (hostname, protocol) => ({ type: MSG.CHECK_PAGE, payload: { hostname, protocol: protocol || "https:" } });

function setup(withEngine) {
  const area = createFakeArea();
  const store = createStore(area);
  const parts = withEngine === false ? {} : { urlIntel, riskEngine };
  const bg = createBackground(Object.assign({ store, runtimeId: ID, version: "0.1.0" }, parts));
  return { bg, store, area };
}

test("CHECK_PAGE is for content scripts only, and pages warnings are on by default", () => {
  assert.deepEqual(MESSAGE_POLICY[MSG.CHECK_PAGE], ["content"]);
  assert.equal(C.DEFAULT_SETTINGS.pageWarnings, true);
  assert.equal(C.DEFAULT_SETTINGS.showAssistantBadge, false, "the assistant badge stays off: only real warnings appear");
  assert.deepEqual(C.PAGE_WARNING_LEVELS.balanced, ["HIGH", "CRITICAL"]);
  assert.deepEqual(C.PAGE_WARNING_LEVELS.relaxed, ["CRITICAL"]);
  for (const levels of Object.values(C.PAGE_WARNING_LEVELS)) {
    assert.ok(!levels.includes("LOW") && !levels.includes("INCONCLUSIVE"), "never warn on LOW or INCONCLUSIVE");
  }
});

test("a scam-like site name gets a warning with the engine's category and reasons; the warning is counted", async () => {
  const { bg, store } = setup();
  const r = await bg.handle(check("sbi-kyc-update.xyz"), tab("sbi-kyc-update.xyz"));
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.warn, true);
  assert.ok(["HIGH", "CRITICAL"].includes(r.category));
  assert.equal(r.host, "sbi-kyc-update.xyz");
  assert.ok(r.reasons.length >= 1 && r.reasons.length <= 3 && r.reasons.every((t) => typeof t === "string" && t.length > 5));
  assert.equal((await store.getStats()).warningsShown, 1);
  const r2 = await bg.handle(check("sbi.co.in.verify-account.xyz"), tab("sbi.co.in.verify-account.xyz"));
  assert.equal(r2.category, "CRITICAL");
  assert.equal((await store.getStats()).warningsShown, 2);
});

test("real and ordinary websites never get a warning (balanced), and nothing is counted", async () => {
  const { bg, store } = setup();
  for (const host of ["www.sbi.co.in", "netbanking.hdfcbank.com", "www.irctc.co.in", "www.amazon.in", "en.wikipedia.org", "github.com", "paytmmall.com", "kotak811.com", "localhost", "192.168.1.1", "bit.ly"]) {
    const proto = host === "localhost" || /^\d/.test(host) ? "http:" : "https:";
    const r = await bg.handle(check(host, proto), tab(host, proto + "//"));
    assert.equal(r.ok, true, host);
    assert.equal(r.warn, false, host);
    assert.equal(r.reasons, undefined, "no details are sent back when there is no warning: " + host);
  }
  assert.equal((await store.getStats()).warningsShown, 0);
});

test("sensitivity decides how early: relaxed only CRITICAL, strict also MEDIUM", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ sensitivity: "relaxed" });
  assert.equal((await bg.handle(check("sbi-kyc-update.xyz"), tab("sbi-kyc-update.xyz"))).warn, false, "HIGH is not enough when relaxed");
  assert.equal((await bg.handle(check("sbi.co.in.verify-account.xyz"), tab("sbi.co.in.verify-account.xyz"))).warn, true);
  await store.saveSettings({ sensitivity: "strict" });
  const medium = await bg.handle(check("paytmmall.com"), tab("paytmmall.com"));
  assert.equal(medium.warn, true);
  assert.equal(medium.category, "MEDIUM");
});

test("no warning when protection is off, page warnings are off, or the site is on the quiet list", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ pageWarnings: false });
  assert.deepEqual(await bg.handle(check("sbi-kyc-update.xyz"), tab("sbi-kyc-update.xyz")), { ok: true, warn: false, skipped: "off" });
  await store.saveSettings({ pageWarnings: true, enabled: false });
  assert.equal((await bg.handle(check("sbi-kyc-update.xyz"), tab("sbi-kyc-update.xyz"))).skipped, "off");
  await store.saveSettings({ enabled: true, mutedSites: ["sbi-kyc-update.xyz"] });
  assert.equal((await bg.handle(check("login.sbi-kyc-update.xyz"), tab("login.sbi-kyc-update.xyz"))).skipped, "quiet-site");
  assert.equal((await store.getStats()).warningsShown, 0);
});

test("CHECK_PAGE refuses other senders, other sites, extra fields and bad values", async () => {
  const { bg } = setup();
  const good = check("sbi-kyc-update.xyz");
  for (const sender of [PAGE, { id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", url: "https://sbi-kyc-update.xyz/", tab: { id: 1 } }, undefined, {}]) {
    assert.equal((await bg.handle(good, sender)).error, "not-allowed");
  }
  // a content script can only ask about its own tab's site
  assert.equal((await bg.handle(good, tab("example.com"))).error, "bad-payload");
  for (const payload of [
    { hostname: "sbi-kyc-update.xyz" },
    { hostname: "sbi-kyc-update.xyz", protocol: "https:", path: "/login" },
    { hostname: "sbi-kyc-update.xyz", protocol: "ftp:" },
    { hostname: "", protocol: "https:" },
    { hostname: "a".repeat(254), protocol: "https:" },
    { hostname: 42, protocol: "https:" },
    null,
  ]) {
    const r = await bg.handle({ type: MSG.CHECK_PAGE, payload }, tab("sbi-kyc-update.xyz"));
    assert.equal(r.ok, false, JSON.stringify(payload));
  }
  assert.equal((await setup(false).bg.handle(good, tab("sbi-kyc-update.xyz"))).error, "unavailable");
});

test("storage after warnings holds only settings and counters, never the site name", async () => {
  const { bg, area } = setup();
  await bg.handle(check("sbi-kyc-update.xyz"), tab("sbi-kyc-update.xyz"));
  const dump = JSON.stringify(area.data);
  assert.doesNotMatch(dump, /sbi-kyc|xyz/);
  assert.deepEqual(Object.keys(area.data).sort(), ["prevenza.settings", "prevenza.stats"].filter((k) => k in area.data).sort().concat(Object.keys(area.data).filter((k) => k === "prevenza.schema")).sort());
});

test("the content script asks once, sends only the site name and protocol, and always offers Continue anyway", () => {
  const code = fs.readFileSync(path.join(__dirname, "..", "src", "content", "content.js"), "utf8");
  assert.match(code, /send\(\{ type: MSG\.CHECK_PAGE, payload: \{ hostname, protocol: location\.protocol \} \}\)/);
  assert.equal((code.match(/MSG\.CHECK_PAGE/g) || []).length, 1);
  assert.match(code, /if \(warnAsked \|\| !isActive\(\) \|\| !settings\.pageWarnings\) return;/);
  assert.match(code, /go\.textContent = "Continue anyway";/);
  assert.match(code, /back\.textContent = "Go back";/);
  assert.match(code, /role", "alertdialog"/);
  assert.match(code, /attachShadow\(\{ mode: "open" \}\)/);
  assert.doesNotMatch(code, /\bsafe\b/i, "the warning never calls anything safe");
  assert.doesNotMatch(code, /chrome\.storage|localStorage|sessionStorage/);
  assert.doesNotMatch(code, /location\.(href|replace|assign|reload)/);
});

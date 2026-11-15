// Step 2: how URL analysis is wired into the extension (message router, settings, privacy). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/shared/constants.js");
const urlIntel = require("../src/shared/url-intel.js");
const { createStore } = require("../src/shared/storage.js");
const { createBackground, MESSAGE_POLICY } = require("../src/background/handler.js");
const { createFakeArea } = require("./helpers/fake-chrome.js");

const MSG = C.MSG;
const ID = "abcdefghijklmnopabcdefghijklmnop";
const PAGE = { id: ID, url: "chrome-extension://" + ID + "/src/popup/popup.html" };
const CONTENT = { id: ID, url: "https://shop.example/page", tab: { id: 3 } };
const FOREIGN = { id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", url: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/x.html" };

function setup(withIntel = true) {
  const area = createFakeArea();
  const store = createStore(area);
  const bg = createBackground({ store, runtimeId: ID, version: "0.1.0", urlIntel: withIntel ? urlIntel : undefined });
  return { bg, store, area };
}
const site = (hostname, protocol = "https:") => ({ type: MSG.ANALYZE_SITE, payload: { hostname, protocol } });
const check = (url) => ({ type: MSG.CHECK_URL, payload: { url } });

test("URL messages are registered for extension pages only", () => {
  assert.deepEqual(MESSAGE_POLICY[MSG.ANALYZE_SITE], ["page"]);
  assert.deepEqual(MESSAGE_POLICY[MSG.CHECK_URL], ["page"]);
});

test("content scripts and foreign senders cannot use URL analysis", async () => {
  const { bg } = setup();
  for (const sender of [CONTENT, FOREIGN, undefined, {}]) {
    for (const m of [site("example.com"), check("https://example.com")]) {
      const r = await bg.handle(m, sender);
      assert.equal(r.ok, false);
      assert.equal(r.error, "not-allowed");
    }
  }
});

test("ANALYZE_SITE returns a result for the site name", async () => {
  const { bg } = setup();
  const r = await bg.handle(site("sbi-kyc-update.xyz"), PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.result.ok, true);
  assert.equal(r.result.level, "high");
  assert.equal(r.result.mode, "site");
  const ok = await bg.handle(site("retail.onlinesbi.sbi"), PAGE);
  assert.equal(ok.result.level, "low");
});

test("ANALYZE_SITE accepts only a site name and protocol (no path, query or extra fields)", async () => {
  const { bg } = setup();
  const bad = [
    undefined, null, "x", [], {},
    { hostname: "a.com" }, { protocol: "https:" },
    { hostname: "a.com", protocol: "https:", path: "/login" },
    { hostname: "a.com", protocol: "https:", url: "https://a.com/x?token=1" },
    { hostname: "a.com", protocol: "https:", text: "page text" },
    { hostname: "", protocol: "https:" }, { hostname: 5, protocol: "https:" },
    { hostname: "a.com", protocol: "ftp:" }, { hostname: "a.com", protocol: "javascript:" }, { hostname: "a.com", protocol: undefined },
    { hostname: "a".repeat(254), protocol: "https:" },
  ];
  for (const payload of bad) {
    const r = await bg.handle({ type: MSG.ANALYZE_SITE, payload }, PAGE);
    assert.equal(r.ok, false, JSON.stringify(payload));
    assert.equal(r.error, "bad-payload");
  }
});

test("CHECK_URL accepts only the 'url' field and a limited length", async () => {
  const { bg } = setup();
  for (const payload of [undefined, null, "x", [], {}, { url: 5 }, { url: null }, { url: "https://a.com", extra: 1 }, { link: "https://a.com" }, { url: "a".repeat(2049) }]) {
    const r = await bg.handle({ type: MSG.CHECK_URL, payload }, PAGE);
    assert.equal(r.ok, false, String(JSON.stringify(payload)).slice(0, 60));
    assert.equal(r.error, "bad-payload");
  }
});

test("CHECK_URL analyses a pasted address and returns reasons", async () => {
  const { bg } = setup();
  const r = await bg.handle(check("https://sbi.co.in@evil.com/login"), PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.result.level, "high");
  assert.equal(r.result.mode, "url");
  assert.equal(r.quietSite, false);
});

test("bad pasted text is answered as a friendly error inside a normal reply", async () => {
  const { bg } = setup();
  for (const text of ["", "not a link ???", "javascript:alert(1)"]) {
    const r = await bg.handle(check(text), PAGE);
    assert.equal(r.ok, true);
    assert.equal(r.result.ok, false);
    assert.ok(r.result.message.length > 8);
  }
});

test("PROTECTION OFF: nothing is analysed", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ enabled: false });
  for (const m of [site("sbi-kyc-update.xyz"), check("https://sbi-kyc-update.xyz")]) {
    const r = await bg.handle(m, PAGE);
    assert.equal(r.ok, true);
    assert.equal(r.skipped, "protection-off");
    assert.equal(r.result, undefined, "no analysis result may be returned while protection is off");
  }
});

test("QUIET SITES: automatic analysis is skipped for the site and its subdomains", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ mutedSites: ["sbi-kyc-update.xyz"] });
  for (const host of ["sbi-kyc-update.xyz", "www.sbi-kyc-update.xyz", "login.sbi-kyc-update.xyz"]) {
    const r = await bg.handle(site(host), PAGE);
    assert.equal(r.skipped, "quiet-site", host);
    assert.equal(r.result, undefined);
  }
  const other = await bg.handle(site("evil-sbi-kyc-update.xyz"), PAGE);
  assert.equal(other.skipped, undefined, "a different site is still analysed");
  assert.equal(other.result.ok, true);
});

test("QUIET SITES: a link the user explicitly checks is still answered, and says the site is quiet", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ mutedSites: ["bit.ly"] });
  const r = await bg.handle(check("https://bit.ly/abc"), PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.quietSite, true);
  assert.equal(r.result.level, "medium");
});

test("changing settings takes effect on the very next analysis", async () => {
  const { bg } = setup();
  assert.equal((await bg.handle(site("bit.ly"), PAGE)).result.level, "medium");
  await bg.handle({ type: MSG.UPDATE_SETTINGS, payload: { settings: { enabled: false } } }, PAGE);
  assert.equal((await bg.handle(site("bit.ly"), PAGE)).skipped, "protection-off");
  await bg.handle({ type: MSG.UPDATE_SETTINGS, payload: { settings: { enabled: true, mutedSites: ["bit.ly"] } } }, PAGE);
  assert.equal((await bg.handle(site("bit.ly"), PAGE)).skipped, "quiet-site");
});

test("PRIVACY: analysing addresses writes nothing to storage", async () => {
  const { bg, area } = setup();
  const before = JSON.stringify(area.data);
  const writesBefore = area.calls.set;
  const secrets = ["https://user:SECRETPW@sbi-kyc-update.xyz/account/TOKEN999?otp=112233", "https://bit.ly/PRIVATE-LINK-77", "paytm.verify-now.in/path"];
  for (const s of secrets) {
    await bg.handle(check(s), PAGE);
    await bg.handle(site(new URL(s.startsWith("http") ? s : "https://" + s).hostname), PAGE);
  }
  assert.equal(area.calls.set, writesBefore, "analysis must not call storage.set");
  assert.equal(area.calls.remove, 0);
  assert.equal(JSON.stringify(area.data), before, "storage must be byte-for-byte unchanged");
  assert.doesNotMatch(JSON.stringify(area.data), /SECRETPW|TOKEN999|112233|PRIVATE-LINK|sbi-kyc-update|verify-now/);
});

test("PRIVACY: analysis does not touch the counters (no history, no warning count)", async () => {
  const { bg, store } = setup();
  for (let i = 0; i < 10; i++) {
    await bg.handle(site("sbi-kyc-update.xyz"), PAGE);
    await bg.handle(check("https://bit.ly/x" + i), PAGE);
  }
  const stats = await store.getStats();
  assert.equal(stats.pagesSeen, 0);
  assert.equal(stats.warningsShown, 0);
});

test("PRIVACY: replies never contain the path, query or credentials", async () => {
  const { bg } = setup();
  const r = await bg.handle(check("https://user:SECRETPW@sbi-kyc-update.xyz/account/TOKEN999?otp=112233#top"), PAGE);
  const text = JSON.stringify(r);
  for (const secret of ["SECRETPW", "TOKEN999", "112233", "/account", "#top"]) assert.ok(!text.includes(secret), secret);
});

test("without the analyzer the router answers 'unavailable' instead of crashing", async () => {
  const { bg } = setup(false);
  const a = await bg.handle(site("example.com"), PAGE);
  const b = await bg.handle(check("https://example.com"), PAGE);
  assert.equal(a.error, "unavailable");
  assert.equal(b.error, "unavailable");
});

test("the content script does not load the URL engine (the page side stays minimal)", () => {
  const manifest = require("../manifest.json");
  const files = manifest.content_scripts.flatMap((c) => c.js);
  assert.ok(!files.some((f) => /url-(intel|rules)/.test(f)), "url engine must not run inside web pages");
  assert.deepEqual(manifest.permissions, ["storage"]);
});

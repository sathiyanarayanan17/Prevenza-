// Storage and settings validation tests (no browser needed). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/shared/constants.js");
const S = require("../src/shared/settings.js");
const { createStore } = require("../src/shared/storage.js");
const { createFakeArea } = require("./helpers/fake-chrome.js");

test("default settings are safe: enabled, silent assistant, balanced, no muted sites", () => {
  assert.deepEqual(S.sanitizeSettings(undefined), {
    enabled: true, elderMode: false, language: "en", sensitivity: "balanced", showAssistantBadge: false, mutedSites: [],
  });
});

test("sanitizeSettings drops unknown keys and invalid values", () => {
  const out = S.sanitizeSettings({
    enabled: "yes", elderMode: 1, language: "xx", sensitivity: "extreme", showAssistantBadge: null,
    mutedSites: "example.com", evil: "<script>", __proto__: { polluted: true },
  });
  assert.equal(out.enabled, true);
  assert.equal(out.elderMode, false);
  assert.equal(out.language, "en");
  assert.equal(out.sensitivity, "balanced");
  assert.equal(out.showAssistantBadge, false);
  assert.deepEqual(out.mutedSites, []);
  assert.equal(out.evil, undefined);
  assert.equal({}.polluted, undefined);
});

test("sanitizeSettings keeps valid values", () => {
  const out = S.sanitizeSettings({ enabled: false, elderMode: true, language: "ta", sensitivity: "strict", showAssistantBadge: true, mutedSites: ["Example.com"] });
  assert.deepEqual(out, { enabled: false, elderMode: true, language: "ta", sensitivity: "strict", showAssistantBadge: true, mutedSites: ["example.com"] });
});

test("normalizeHostname accepts real hostnames and rejects junk", () => {
  assert.equal(S.normalizeHostname("https://www.Example.com:8080/path?q=1"), "example.com");
  assert.equal(S.normalizeHostname("  bank.co.in "), "bank.co.in");
  assert.equal(S.normalizeHostname("localhost"), "localhost");
  for (const bad of ["", "   ", "exa mple.com", "-bad.com", "bad-.com", "a..b", "<script>", "javascript:alert(1)", "a".repeat(300) + ".com", 42, null, undefined, {}]) {
    assert.equal(S.normalizeHostname(bad), null, "should reject " + String(bad).slice(0, 20));
  }
});

test("mutedSites are de-duplicated, normalized and capped", () => {
  const many = Array.from({ length: 300 }, (_, i) => "site" + i + ".com");
  const out = S.sanitizeSettings({ mutedSites: ["A.com", "a.com", "https://www.a.com/x", "not valid", ...many] });
  assert.equal(out.mutedSites[0], "a.com");
  assert.equal(out.mutedSites.filter((s) => s === "a.com").length, 1);
  assert.ok(!out.mutedSites.includes("not valid"));
  assert.equal(out.mutedSites.length, C.LIMITS.maxMutedSites);
});

test("isMuted matches the site and its subdomains only", () => {
  const list = ["example.com"];
  assert.equal(S.isMuted("example.com", list), true);
  assert.equal(S.isMuted("www.example.com", list), true);
  assert.equal(S.isMuted("login.example.com", list), true);
  assert.equal(S.isMuted("notexample.com", list), false);
  assert.equal(S.isMuted("example.com.evil.net", list), false);
  assert.equal(S.isMuted("", list), false);
  assert.equal(S.isMuted("example.com", undefined), false);
});

test("sanitizeStats only keeps counters and timestamps", () => {
  const out = S.sanitizeStats({ pagesSeen: 5, warningsShown: -3, installedAt: "2026-01-02T03:04:05Z", lastActiveAt: "garbage", url: "https://secret.example/", text: "hello" });
  assert.deepEqual(Object.keys(out).sort(), ["installedAt", "lastActiveAt", "lastScanAt", "pagesSeen", "scansCritical", "scansHigh", "scansInconclusive", "scansLow", "scansMedium", "scansTotal", "warningsShown"]);
  assert.equal(out.pagesSeen, 5);
  assert.equal(out.warningsShown, 0);
  assert.equal(out.installedAt, "2026-01-02T03:04:05.000Z");
  assert.equal(out.lastActiveAt, null);
});

test("store.init writes defaults, an install time and the schema version", async () => {
  const area = createFakeArea();
  const store = createStore(area, () => "2026-01-01T00:00:00.000Z");
  await store.init();
  assert.deepEqual(area.data[C.STORAGE_KEYS.settings], S.sanitizeSettings({}));
  assert.equal(area.data[C.STORAGE_KEYS.stats].installedAt, "2026-01-01T00:00:00.000Z");
  assert.equal(area.data[C.STORAGE_KEYS.schema], C.SCHEMA_VERSION);
});

test("store.init keeps existing user settings and the original install time", async () => {
  const area = createFakeArea({
    [C.STORAGE_KEYS.settings]: { enabled: false, elderMode: true },
    [C.STORAGE_KEYS.stats]: { installedAt: "2025-05-05T00:00:00.000Z", pagesSeen: 9 },
  });
  const store = createStore(area, () => "2026-01-01T00:00:00.000Z");
  await store.init();
  const settings = await store.getSettings();
  const stats = await store.getStats();
  assert.equal(settings.enabled, false);
  assert.equal(settings.elderMode, true);
  assert.equal(stats.pagesSeen, 9);
  assert.equal(stats.installedAt, "2025-05-05T00:00:00.000Z");
});

test("store.saveSettings merges, validates and persists", async () => {
  const area = createFakeArea();
  const store = createStore(area);
  const a = await store.saveSettings({ elderMode: true, language: "hi" });
  assert.equal(a.elderMode, true);
  assert.equal(a.language, "hi");
  const b = await store.saveSettings({ language: "nope", sensitivity: "strict" });
  assert.equal(b.language, "en", "invalid language falls back to the default");
  assert.equal(b.sensitivity, "strict");
  assert.equal(b.elderMode, true, "earlier change is kept");
  assert.deepEqual(await store.getSettings(), b);
});

test("store.saveSettings ignores a non-object update", async () => {
  const store = createStore(createFakeArea());
  const before = await store.getSettings();
  assert.deepEqual(await store.saveSettings("evil"), before);
  assert.deepEqual(await store.saveSettings(null), before);
  assert.deepEqual(await store.saveSettings([1, 2]), before);
});

test("rapid updates never overwrite each other (writes are queued)", async () => {
  const store = createStore(createFakeArea());
  await Promise.all([
    store.saveSettings({ elderMode: true }),
    store.saveSettings({ language: "ta" }),
    store.saveSettings({ showAssistantBadge: true }),
    store.saveSettings({ mutedSites: ["a.com"] }),
  ]);
  const s = await store.getSettings();
  assert.equal(s.elderMode, true);
  assert.equal(s.language, "ta");
  assert.equal(s.showAssistantBadge, true);
  assert.deepEqual(s.mutedSites, ["a.com"]);
});

test("many page counts at once are all counted", async () => {
  const store = createStore(createFakeArea());
  await Promise.all(Array.from({ length: 25 }, () => store.recordPageSeen()));
  assert.equal((await store.getStats()).pagesSeen, 25);
});

test("recordPageSeen stores a count and a time, nothing else", async () => {
  const area = createFakeArea();
  const store = createStore(area, () => "2026-02-02T00:00:00.000Z");
  await store.recordPageSeen();
  assert.deepEqual(Object.keys(area.data[C.STORAGE_KEYS.stats]).sort(), ["installedAt", "lastActiveAt", "lastScanAt", "pagesSeen", "scansCritical", "scansHigh", "scansInconclusive", "scansLow", "scansMedium", "scansTotal", "warningsShown"]);
  assert.equal(area.data[C.STORAGE_KEYS.stats].lastActiveAt, "2026-02-02T00:00:00.000Z");
});

test("resetStats clears counters but keeps the install date; resetSettings restores defaults", async () => {
  const store = createStore(createFakeArea(), () => "2026-03-03T00:00:00.000Z");
  await store.init();
  await store.recordPageSeen();
  await store.saveSettings({ elderMode: true });
  const stats = await store.resetStats();
  assert.equal(stats.pagesSeen, 0);
  assert.equal(stats.installedAt, "2026-03-03T00:00:00.000Z");
  const settings = await store.resetSettings();
  assert.deepEqual(settings, S.sanitizeSettings({}));
});

test("corrupted stored data is sanitized instead of crashing", async () => {
  const area = createFakeArea({ [C.STORAGE_KEYS.settings]: "garbage", [C.STORAGE_KEYS.stats]: [1, 2, 3] });
  const store = createStore(area);
  assert.deepEqual(await store.getSettings(), S.sanitizeSettings({}));
  assert.equal((await store.getStats()).pagesSeen, 0);
});

test("selfTest writes, reads back and cleans up", async () => {
  const area = createFakeArea();
  const store = createStore(area);
  assert.equal(await store.selfTest(), true);
  assert.equal(C.STORAGE_KEYS.selfTest in area.data, false);
});

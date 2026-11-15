// Message router tests: who may send what, and what comes back. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/shared/constants.js");
const { createStore } = require("../src/shared/storage.js");
const { createBackground, MESSAGE_POLICY } = require("../src/background/handler.js");
const { createFakeArea } = require("./helpers/fake-chrome.js");

const MSG = C.MSG;
const ID = "abcdefghijklmnopabcdefghijklmnop";
const PAGE = { id: ID, url: "chrome-extension://" + ID + "/src/popup/popup.html" };
const SETTINGS_TAB = { id: ID, url: "chrome-extension://" + ID + "/src/settings/settings.html", tab: { id: 7 } }; // settings opens in a tab
const CONTENT = { id: ID, url: "https://shop.example/page", tab: { id: 3 } };
const OTHER_EXTENSION = { id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", url: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/x.html" };
const WEBPAGE_SPOOF = { url: "https://evil.example/", tab: { id: 9 } }; // no extension id

function setup() {
  const sent = [];
  const store = createStore(createFakeArea());
  const bg = createBackground({
    store,
    runtimeId: ID,
    version: "0.1.0",
    broadcast: async (m) => void sent.push(m),
    now: () => 1000,
  });
  return { bg, store, sent };
}

test("PING works from extension pages and content scripts", async () => {
  const { bg } = setup();
  for (const sender of [PAGE, SETTINGS_TAB, CONTENT]) {
    const r = await bg.handle({ type: MSG.PING }, sender);
    assert.equal(r.ok, true);
    assert.equal(r.pong, true);
    assert.equal(r.version, "0.1.0");
  }
});

test("malformed messages are rejected", async () => {
  const { bg } = setup();
  for (const bad of [null, undefined, "ping", 42, [], {}, { type: 5 }, { type: "" }, { type: "prevenza/evil" }]) {
    const r = await bg.handle(bad, PAGE);
    assert.equal(r.ok, false, "should reject " + JSON.stringify(bad));
  }
});

test("messages from other extensions or spoofed web pages are rejected", async () => {
  const { bg } = setup();
  for (const sender of [OTHER_EXTENSION, WEBPAGE_SPOOF, undefined, null, {}]) {
    for (const type of Object.keys(MESSAGE_POLICY)) {
      const r = await bg.handle({ type }, sender);
      assert.equal(r.ok, false, type + " from " + JSON.stringify(sender));
      assert.equal(r.error, "not-allowed");
    }
  }
});

test("content scripts cannot read state or change settings", async () => {
  const { bg } = setup();
  for (const type of [MSG.GET_STATE, MSG.UPDATE_SETTINGS, MSG.RESET_STATS, MSG.RESET_SETTINGS, MSG.DIAGNOSTICS]) {
    const r = await bg.handle({ type, payload: { settings: { enabled: false } } }, CONTENT);
    assert.equal(r.ok, false, type);
    assert.equal(r.error, "not-allowed");
  }
});

test("extension pages cannot pretend to be a content script", async () => {
  const { bg } = setup();
  const r = await bg.handle({ type: MSG.CONTENT_READY }, PAGE);
  assert.equal(r.ok, false);
});

test("GET_STATE returns settings, stats and version", async () => {
  const { bg } = setup();
  const r = await bg.handle({ type: MSG.GET_STATE }, PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.settings.enabled, true);
  assert.equal(r.stats.pagesSeen, 0);
  assert.equal(r.version, "0.1.0");
});

test("CONTENT_READY returns settings and counts the page when protection is on", async () => {
  const { bg, store } = setup();
  const r = await bg.handle({ type: MSG.CONTENT_READY }, CONTENT);
  assert.equal(r.ok, true);
  assert.equal(r.settings.enabled, true);
  assert.equal((await store.getStats()).pagesSeen, 1);
});

test("CONTENT_READY does not count pages while protection is off", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ enabled: false });
  const r = await bg.handle({ type: MSG.CONTENT_READY }, CONTENT);
  assert.equal(r.ok, true);
  assert.equal(r.settings.enabled, false);
  assert.equal((await store.getStats()).pagesSeen, 0);
});

test("CONTENT_READY reply contains no stored statistics", async () => {
  const { bg } = setup();
  const r = await bg.handle({ type: MSG.CONTENT_READY }, CONTENT);
  assert.deepEqual(Object.keys(r).sort(), ["ok", "settings"]);
});

test("UPDATE_SETTINGS saves, validates and broadcasts to content scripts", async () => {
  const { bg, store, sent } = setup();
  const r = await bg.handle({ type: MSG.UPDATE_SETTINGS, payload: { settings: { elderMode: true, language: "bogus" } } }, SETTINGS_TAB);
  assert.equal(r.ok, true);
  assert.equal(r.settings.elderMode, true);
  assert.equal(r.settings.language, "en");
  assert.equal((await store.getSettings()).elderMode, true);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, MSG.SETTINGS_UPDATED);
  assert.equal(sent[0].payload.settings.elderMode, true);
});

test("UPDATE_SETTINGS rejects a missing or wrong payload", async () => {
  const { bg, sent } = setup();
  for (const payload of [undefined, null, "x", [], {}, { settings: "x" }, { settings: [] }, { settings: null }]) {
    const r = await bg.handle({ type: MSG.UPDATE_SETTINGS, payload }, PAGE);
    assert.equal(r.ok, false, JSON.stringify(payload));
    assert.equal(r.error, "bad-payload");
  }
  assert.equal(sent.length, 0, "nothing is broadcast for rejected updates");
});

test("RESET_SETTINGS restores defaults and broadcasts", async () => {
  const { bg, store, sent } = setup();
  await store.saveSettings({ elderMode: true, mutedSites: ["a.com"] });
  const r = await bg.handle({ type: MSG.RESET_SETTINGS }, PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.settings.elderMode, false);
  assert.deepEqual(r.settings.mutedSites, []);
  assert.equal(sent.length, 1);
});

test("RESET_STATS clears the counters", async () => {
  const { bg, store } = setup();
  await store.recordPageSeen();
  const r = await bg.handle({ type: MSG.RESET_STATS }, PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.stats.pagesSeen, 0);
});

test("DIAGNOSTICS confirms storage works", async () => {
  const { bg } = setup();
  const r = await bg.handle({ type: MSG.DIAGNOSTICS }, PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.storageOk, true);
  assert.equal(typeof r.workerTime, "number");
});

test("a failing broadcast does not break saving settings", async () => {
  const store = createStore(createFakeArea());
  const bg = createBackground({ store, runtimeId: ID, version: "0.1.0", broadcast: async () => undefined });
  const r = await bg.handle({ type: MSG.UPDATE_SETTINGS, payload: { settings: { elderMode: true } } }, PAGE);
  assert.equal(r.ok, true);
});

test("every message type in the policy has a handler (no dead entries)", async () => {
  const { bg } = setup();
  for (const [type, kinds] of Object.entries(MESSAGE_POLICY)) {
    const sender = kinds.includes("page") ? PAGE : CONTENT;
    const r = await bg.handle({ type, payload: { settings: {} } }, sender);
    assert.notEqual(r.error, "unknown-type", type + " has no handler");
  }
});

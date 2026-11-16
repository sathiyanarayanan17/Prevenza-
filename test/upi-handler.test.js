// Step 5: how the UPI analyzer is wired into the background worker (permissions, validation, privacy, protection switch).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/shared/constants.js");
const urlIntel = require("../src/shared/url-intel.js");
const messageScan = require("../src/shared/message-scan.js");
const riskEngine = require("../src/shared/risk-engine.js");
const upiAnalyze = require("../src/shared/upi-analyze.js");
const { createStore } = require("../src/shared/storage.js");
const { createBackground, MESSAGE_POLICY } = require("../src/background/handler.js");
const { createFakeArea } = require("./helpers/fake-chrome.js");

const MSG = C.MSG;
const ID = "abcdefghijklmnopabcdefghijklmnop";
const PAGE = { id: ID, url: "chrome-extension://" + ID + "/src/dashboard/dashboard.html" };
const CONTENT = { id: ID, url: "https://shop.example/page", tab: { id: 3 } };
const FOREIGN = { id: "zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz", url: "chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz/x.html" };

function setup(parts) {
  const area = createFakeArea();
  const store = createStore(area);
  const wanted = parts || { urlIntel, messageScan, riskEngine, upiAnalyze };
  const bg = createBackground(Object.assign({ store, runtimeId: ID, version: "0.1.0" }, wanted));
  return { bg, store, area };
}
const upi = (payload) => ({ type: MSG.ANALYZE_UPI, payload });

test("the UPI message type is registered for extension pages only", () => {
  assert.deepEqual(MESSAGE_POLICY[MSG.ANALYZE_UPI], ["page"]);
});

test("content scripts and foreign senders cannot use the UPI analyzer", async () => {
  const { bg } = setup();
  for (const sender of [CONTENT, FOREIGN, undefined, {}, { id: ID }]) {
    const r = await bg.handle(upi({ upiId: "a@ybl" }), sender);
    assert.equal(r.ok, false);
    assert.equal(r.error, "not-allowed");
  }
});

test("a scam payment gets a full assessment from the central engine, with a Holdy warning", async () => {
  const { bg } = setup();
  const r = await bg.handle(upi({ upiId: "sbi.customercare@ybl", name: "SBI Support", amount: "10", reason: "Pay Rs 10 to get your refund", qrText: "" }), PAGE);
  assert.equal(r.ok, true);
  const x = r.result;
  assert.equal(x.ok, true);
  const a = x.assessment;
  for (const key of ["score", "category", "confidence", "evidence", "reasons", "availableModules", "unavailableModules", "recommendedAction", "analysisTimestamp"]) assert.ok(key in a, key);
  assert.deepEqual(a.availableModules, ["payment"]);
  assert.ok(["HIGH", "CRITICAL"].includes(a.category));
  assert.ok(a.reasons.length >= 3 && a.reasons.every((q) => q.moduleLabel === "UPI payment details"));
  assert.ok(x.warning && /pay to receive money/i.test(x.warning.headline));
  assert.match(x.cannotStop, /cannot stop or cancel a payment/i);
  assert.deepEqual(x.checked.sort(), ["Amount", "Reason or request message", "Recipient UPI ID", "Recipient name"].sort());
});

test("a normal payment gets LOW, no warning and is not called safe", async () => {
  const { bg } = setup();
  const r = await bg.handle(upi({ upiId: "ramesh.k@oksbi", amount: "500", reason: "Dinner share" }), PAGE);
  assert.equal(r.result.assessment.category, "LOW");
  assert.equal(r.result.warning, null);
  assert.match(r.result.assessment.confidence.note, /not proof of safety/i);
});

test("a pasted QR code is read and its contents are shown back to the page", async () => {
  const { bg } = setup();
  const r = await bg.handle(upi({ qrText: "upi://collect?pa=other@ybl&pn=X&am=5000" }), PAGE);
  assert.equal(r.result.qr.kind, "collect");
  assert.equal(r.result.qr.recipient, "other@ybl");
  assert.equal(r.result.qr.amount, 5000);
  assert.ok(r.result.assessment.evidence.some((e) => e.id === "upi_qr_collect_request"));
  const bad = await bg.handle(upi({ qrText: "hello world" }), PAGE);
  assert.equal(bad.result.ok, false);
  assert.match(bad.result.problems[0].message, /could not read this as a UPI payment code/i);
});

test("only the five text fields are accepted, each within its limit", async () => {
  const { bg } = setup();
  const bad = [
    undefined, null, "x", [], 5,
    { upiId: 5 }, { upiId: null }, { amount: 100 }, { reason: ["a"] }, { name: {} },
    { upiId: "a@ybl", pin: "1234" }, { upiId: "a@ybl", otp: "123456" }, { upiId: "a@ybl", extra: "x" },
    { upiId: "a".repeat(C.UPI_LIMITS.upiId + 1) },
    { name: "a".repeat(C.UPI_LIMITS.name + 1) },
    { amount: "1".repeat(C.UPI_LIMITS.amount + 1) },
    { reason: "a".repeat(C.UPI_LIMITS.reason + 1) },
    { qrText: "a".repeat(C.UPI_LIMITS.qrText + 1) },
  ];
  for (const payload of bad) {
    const r = await bg.handle(upi(payload), PAGE);
    assert.equal(r.ok, false, String(JSON.stringify(payload)).slice(0, 60));
    assert.equal(r.error, "bad-payload");
  }
});

test("a PIN or OTP sent as an extra field is refused, not read", async () => {
  const { bg } = setup();
  const r = await bg.handle(upi({ upiId: "a@ybl", amount: "10", upiPin: "4321", otp: "889900" }), PAGE);
  assert.equal(r.ok, false);
  assert.ok(!JSON.stringify(r).includes("4321"));
});

test("empty and unreadable input gets a friendly answer, not an error", async () => {
  const { bg } = setup();
  let r = await bg.handle(upi({}), PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.error, "empty");
  r = await bg.handle(upi({ upiId: "", amount: "  " }), PAGE);
  assert.equal(r.result.error, "empty");
  r = await bg.handle(upi({ upiId: "not valid" }), PAGE);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.error, "unreadable");
  assert.ok(r.result.problems.length === 1);
});

test("protection off: nothing is analysed", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ enabled: false });
  const r = await bg.handle(upi({ upiId: "refund@ybl", amount: "10" }), PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.skipped, "protection-off");
  assert.equal(r.result, undefined);
  await store.saveSettings({ enabled: true });
  assert.equal((await bg.handle(upi({ upiId: "refund@ybl", amount: "10" }), PAGE)).result.ok, true);
});

test("without the analyzer, the scanner or the engine the worker says 'unavailable'", async () => {
  for (const parts of [{ urlIntel }, { urlIntel, messageScan, riskEngine }, { urlIntel, messageScan, upiAnalyze }, { upiAnalyze, riskEngine }]) {
    const { bg } = setup(parts);
    const r = await bg.handle(upi({ upiId: "a@ybl" }), PAGE);
    assert.equal(r.ok, false);
    assert.equal(r.error, "unavailable");
  }
});

test("payment details are never stored, and storage is not even written", async () => {
  const { bg, area } = setup();
  await bg.handle({ type: MSG.GET_STATE }, PAGE);
  const writes = area.calls.set;
  const secrets = ["zq9private4471@ybl", "Zq9 Private Person", "4471.55", "zq9-private-reason", "9876543210", "private-qr@ybl"];
  await bg.handle(upi({ upiId: secrets[0], name: secrets[1], amount: secrets[2], reason: secrets[3] + " pay to receive refund " + secrets[4], qrText: "upi://pay?pa=" + secrets[5] + "&am=5" }), PAGE);
  await bg.handle(upi({ upiId: secrets[0] }), PAGE);
  assert.equal(area.calls.set, writes);
  const stored = JSON.stringify(area.data);
  for (const s of secrets) assert.ok(!stored.includes(s), s);
  const allowed = new Set(["prevenza.schema", "prevenza.settings", "prevenza.stats"]);
  assert.ok(Object.keys(area.data).every((k) => allowed.has(k)));
});

test("a link inside the reason is also checked, and not echoed back", async () => {
  const { bg } = setup();
  const r = await bg.handle(upi({ upiId: "a@ybl", amount: "10", reason: "Pay to https://sbi-kyc-update.xyz/login now" }), PAGE);
  assert.equal(r.result.linksChecked, 1);
  assert.deepEqual(r.result.assessment.availableModules.sort(), ["payment", "url"]);
  assert.ok(!JSON.stringify(r).includes("/login"));
});

test("existing checks still work next to the UPI analyzer (URL, site and message)", async () => {
  const { bg } = setup();
  const url = await bg.handle({ type: MSG.CHECK_URL, payload: { url: "https://sbi-kyc-update.xyz/login" } }, PAGE);
  assert.equal(url.result.level, "high");
  const site = await bg.handle({ type: MSG.ANALYZE_SITE, payload: { hostname: "retail.onlinesbi.sbi", protocol: "https:" } }, PAGE);
  assert.equal(site.result.level, "low");
  const msg = await bg.handle({ type: MSG.SCAN_MESSAGE, payload: { text: "Dear customer, your SBI KYC is pending. Your account will be blocked today. Click here to update immediately." } }, PAGE);
  assert.ok(["HIGH", "CRITICAL"].includes(msg.result.assessment.category));
  assert.deepEqual(msg.result.assessment.availableModules, ["message"]);
  const settings = await bg.handle({ type: MSG.UPDATE_SETTINGS, payload: { settings: { elderMode: true } } }, PAGE);
  assert.equal(settings.settings.elderMode, true);
  const ping = await bg.handle({ type: MSG.PING }, PAGE);
  assert.equal(ping.pong, true);
});

test("the form has no field for a PIN or an OTP, and says never to type one", () => {
  const fs = require("node:fs");
  const path = require("node:path");
  const html = fs.readFileSync(path.join(__dirname, "..", "src", "dashboard", "dashboard.html"), "utf8");
  const section = html.slice(html.indexOf('id="upi-check"'), html.indexOf('id="screenshot-check"'));
  assert.match(section, /Never type your UPI PIN or an OTP here/);
  assert.doesNotMatch(section, /type="password"|name="[^"]*(pin|otp)|id="[^"]*(pin|otp)/i);
  assert.match(section, /does not use your camera/i);
  assert.doesNotMatch(section, /type="file"|capture=/i);
});

// Step 4: how the message checker is wired into the background worker (permissions, validation, privacy, protection switch).
const test = require("node:test");
const assert = require("node:assert/strict");
const C = require("../src/shared/constants.js");
const urlIntel = require("../src/shared/url-intel.js");
const messageScan = require("../src/shared/message-scan.js");
const riskEngine = require("../src/shared/risk-engine.js");
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
  const wanted = parts || { urlIntel, messageScan, riskEngine };
  const bg = createBackground(Object.assign({ store, runtimeId: ID, version: "0.1.0" }, wanted));
  return { bg, store, area };
}
const scanMsg = (text, language) => ({ type: MSG.SCAN_MESSAGE, payload: language === undefined ? { text } : { text, language } });

test("the message message type is registered for extension pages only", () => {
  assert.deepEqual(MESSAGE_POLICY[MSG.SCAN_MESSAGE], ["page"]);
});

test("content scripts and foreign senders cannot use the message checker", async () => {
  const { bg } = setup();
  for (const sender of [CONTENT, FOREIGN, undefined, {}, { id: ID }]) {
    const r = await bg.handle(scanMsg("Share your OTP"), sender);
    assert.equal(r.ok, false);
    assert.equal(r.error, "not-allowed");
  }
});

test("a scam message gets a full assessment from the central risk engine", async () => {
  const { bg } = setup();
  const r = await bg.handle(scanMsg("Dear customer, your SBI KYC is pending. Your account will be blocked today. Click here to update immediately."), PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.result.ok, true);
  const a = r.result.assessment;
  assert.equal(a.status, "scanned");
  assert.ok(a.score >= 50 && ["HIGH", "CRITICAL"].includes(a.category));
  for (const key of ["score", "category", "confidence", "evidence", "reasons", "availableModules", "unavailableModules", "recommendedAction", "analysisTimestamp"]) {
    assert.ok(key in a, "assessment is missing " + key);
  }
  assert.deepEqual(a.availableModules, ["message"]);
  assert.ok(a.unavailableModules.some((m) => m.id === "payment"), "UPI analysis is not part of this step and is listed as unavailable");
  assert.equal(r.result.primaryCategory.id, "fake_kyc");
  assert.ok(a.reasons.every((x) => x.moduleLabel === "Message text"));
  assert.ok(r.result.highlights.length >= 1);
  assert.equal(r.result.linksChecked, 0);
});

test("the reply never contains a copy of the message", async () => {
  const { bg } = setup();
  const marker = "Zq9-private-marker-31415";
  const r = await bg.handle(scanMsg("Please share your OTP now " + marker), PAGE);
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes("private-marker"));
});

test("nothing about the message is stored, and storage is not even written", async () => {
  const { bg, area } = setup();
  await bg.handle({ type: MSG.GET_STATE }, PAGE);
  const writesBefore = area.calls.set;
  const marker = "Zq9-private-marker-27182";
  for (const text of ["Share your OTP " + marker, "Hello " + marker, "आपका केवाईसी अपडेट अधूरा है " + marker]) {
    await bg.handle(scanMsg(text), PAGE);
  }
  assert.equal(area.calls.set, writesBefore, "scanning must not write to storage");
  assert.ok(!JSON.stringify(area.data).includes("private-marker"));
  const allowed = new Set(["prevenza.schema", "prevenza.settings", "prevenza.stats"]);
  assert.ok(Object.keys(area.data).every((k) => allowed.has(k)), "only settings, stats and schema may ever be stored: " + Object.keys(area.data).join());
});

test("only text and an optional language are accepted", async () => {
  const { bg } = setup();
  const bad = [
    undefined, null, "x", [], 5, {},
    { text: 5 }, { text: null }, { text: ["a"] }, { text: {} },
    { text: "hi", url: "https://a.example" },
    { text: "hi", extra: 1 },
    { text: "hi", language: "klingon" },
    { text: "hi", language: 5 },
    { text: "hi", language: null },
    { text: "x".repeat(C.MESSAGE_LIMITS.maxInput + 1) },
  ];
  for (const payload of bad) {
    const r = await bg.handle({ type: MSG.SCAN_MESSAGE, payload }, PAGE);
    assert.equal(r.ok, false, String(JSON.stringify(payload)).slice(0, 80));
    assert.equal(r.error, "bad-payload");
  }
  for (const language of ["auto", "en", "hi", "ta", "hinglish"]) {
    const r = await bg.handle(scanMsg("hello there friend", language), PAGE);
    assert.equal(r.ok, true, language);
    assert.equal(r.result.language.selected, language);
  }
});

test("empty text gets a friendly answer, not an error", async () => {
  const { bg } = setup();
  for (const text of ["", "   ", "\n"]) {
    const r = await bg.handle(scanMsg(text), PAGE);
    assert.equal(r.ok, true);
    assert.equal(r.result.ok, false);
    assert.equal(r.result.error, "empty");
    assert.match(r.result.message, /paste/i);
  }
});

test("protection off: nothing is analysed", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ enabled: false });
  const r = await bg.handle(scanMsg("Share your OTP"), PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.skipped, "protection-off");
  assert.equal(r.result, undefined);
  await store.saveSettings({ enabled: true });
  assert.equal((await bg.handle(scanMsg("Share your OTP"), PAGE)).result.ok, true);
});

test("a quiet site does not stop the message checker (it is not about a site)", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ mutedSites: ["example.com"] });
  const r = await bg.handle(scanMsg("Share your OTP now"), PAGE);
  assert.equal(r.result.ok, true);
});

test("without the scanner or the engine the worker says 'unavailable' instead of guessing", async () => {
  for (const parts of [{ urlIntel }, { urlIntel, messageScan }, { urlIntel, riskEngine }]) {
    const { bg } = setup(parts);
    const r = await bg.handle(scanMsg("Share your OTP"), PAGE);
    assert.equal(r.ok, false);
    assert.equal(r.error, "unavailable");
  }
});

test("a link inside the message is also checked by the URL checker, and counted once", async () => {
  const { bg } = setup();
  const withoutLink = await bg.handle(scanMsg("Your KYC is pending. Update immediately."), PAGE);
  const withLink = await bg.handle(scanMsg("Your KYC is pending. Update immediately at https://sbi-kyc-update.xyz/login"), PAGE);
  assert.equal(withLink.result.linksChecked, 1);
  assert.deepEqual(withLink.result.assessment.availableModules.sort(), ["message", "url"]);
  assert.ok(withLink.result.assessment.score > withoutLink.result.assessment.score, "a look-alike bank link raises the result");
  const evidenceIds = withLink.result.assessment.evidence.map((e) => e.id);
  assert.equal(new Set(evidenceIds).size, evidenceIds.length, "no indicator is counted twice");
  assert.ok(withLink.result.assessment.reasons.some((x) => x.module === "url"));
  assert.ok(!JSON.stringify(withLink).includes("/login"), "the link itself is not echoed back");
});

test("at most three links are checked, and an unreadable link is skipped safely", async () => {
  const { bg } = setup();
  const r = await bg.handle(scanMsg("see https://a.example.org https://b.example.org https://c.example.org https://d.example.org"), PAGE);
  assert.equal(r.result.linksChecked, 3);
  const odd = await bg.handle(scanMsg("open http://[bad and www.example.com"), PAGE);
  assert.equal(odd.ok, true);
});

test("a long message is analysed in part and says so", async () => {
  const { bg } = setup();
  const r = await bg.handle(scanMsg("Dear customer, all is well. ".repeat(220)), PAGE); // about 6,000 characters: over the 5,000 analysed, under the 20,000 accepted
  assert.equal(r.result.truncated, true);
  assert.equal(r.result.analysedLength, C.MESSAGE_LIMITS.maxAnalysed);
});

test("URL messages still work next to the message checker (no regression)", async () => {
  const { bg } = setup();
  const r = await bg.handle({ type: MSG.CHECK_URL, payload: { url: "https://sbi-kyc-update.xyz/login" } }, PAGE);
  assert.equal(r.ok, true);
  assert.equal(r.result.level, "high");
  const site = await bg.handle({ type: MSG.ANALYZE_SITE, payload: { hostname: "retail.onlinesbi.sbi", protocol: "https:" } }, PAGE);
  assert.equal(site.result.level, "low");
});

test("shared constants for the checker are sane", () => {
  assert.equal(C.SCAN_LANGUAGES[0].id, "auto");
  assert.deepEqual(C.SCAN_LANGUAGES.map((l) => l.id), ["auto", "en", "hi", "ta", "hinglish"]);
  assert.ok(C.MESSAGE_LIMITS.maxAnalysed <= C.MESSAGE_LIMITS.maxInput);
  assert.equal(C.MESSAGE_LIMITS.maxAnalysed, require("../src/shared/message-rules.js").LIMITS.maxChars, "the page limit and the scanner limit agree");
});

// A message mostly in a language the rules cannot read must never come back as "low risk".
test("a message in a language Prevenza cannot read is INCONCLUSIVE, not LOW, and says why", async () => {
  const { bg } = setup();
  for (const text of [
    "તમારું ખાતું આજે બંધ થઈ જશે. હમણાં જ OTP મોકલો", // Gujarati
    "ਤੁਹਾਡਾ ਖਾਤਾ ਅੱਜ ਬੰਦ ਹੋ ਜਾਵੇਗਾ। ਹੁਣੇ OTP ਭੇਜੋ", // Punjabi (Gurmukhi)
    "ଆପଣଙ୍କ ଖାତା ଆଜି ବନ୍ଦ ହୋଇଯିବ। ଏବେ OTP ପଠାନ୍ତୁ", // Odia
    "مرحبا أرسل رمز OTP الآن", // Arabic
    "Отправьте код OTP сейчас, иначе счёт будет заблокирован", // Russian
  ]) {
    const r = await bg.handle(scanMsg(text), PAGE);
    assert.equal(r.ok, true);
    assert.equal(r.result.assessment.category, "INCONCLUSIVE", text);
    assert.equal(r.result.assessment.score, null);
    assert.equal(r.result.unsupportedScript, true);
    assert.match(r.result.languageNote, /cannot read yet/);
    assert.ok(r.result.assessment.unavailableModules.some((m) => m.id === "message" && /cannot read/.test(m.reason)));
    assert.equal(r.result.shortText, false, "an unreadable message is not described as 'very short'");
  }
});

test("an unreadable-language message with a dangerous link still warns about the link; a harmless link does not make it LOW", async () => {
  const { bg } = setup();
  const bad = await bg.handle(scanMsg("તમારું ખાતું આજે બંધ થઈ જશે, હમણાં જ અહીં ક્લિક કરો http://185.23.4.1/kyc"), PAGE);
  assert.ok(["HIGH", "CRITICAL", "MEDIUM"].includes(bad.result.assessment.category), bad.result.assessment.category);
  const ok = await bg.handle(scanMsg("તમારું ખાતું આજે બંધ થઈ જશે, હમણાં જ અહીં ક્લિક કરો https://www.google.com"), PAGE);
  assert.equal(ok.result.assessment.category, "INCONCLUSIVE");
});

test("supported languages, emoji and accented English are unaffected by the unreadable-language rule", async () => {
  const { bg } = setup();
  for (const text of ["Hi Amma, I will reach home by 7 pm.", "Café meeting at 5? Ça va", "नमस्ते, कल मिलते हैं", "நாளை காலை கோவிலுக்குப் போகலாம்", "😀😀😀", "Your OTP is 123456 – ঢাকা"]) {
    const r = await bg.handle(scanMsg(text), PAGE);
    assert.equal(r.result.unsupportedScript, false, text);
    assert.equal(r.result.assessment.category, "LOW", text);
  }
  // a scam in English with a few letters of another script is still caught
  const mixed = await bg.handle(scanMsg("તમારું ખાતું. Share the OTP now with me, your account will be blocked today"), PAGE);
  assert.ok(["HIGH", "CRITICAL"].includes(mixed.result.assessment.category));
});

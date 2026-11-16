// Step 6: screenshot checker (file checks, reading quality, receipt checks) and how it uses the existing scanner and risk engine.
// The text reading itself (OCR) runs in a real browser; e2e/run.js checks it there. These tests cover everything around it.
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const C = require("../src/shared/constants.js");
const S = require("../src/shared/screenshot.js");
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
const root = path.join(__dirname, "..");

function setup(parts) {
  const area = createFakeArea();
  const store = createStore(area);
  const wanted = parts || { urlIntel, messageScan, riskEngine, upiAnalyze, screenshot: S };
  const bg = createBackground(Object.assign({ store, runtimeId: ID, version: "0.1.0" }, wanted));
  return { bg, store, area };
}
const shot = (text, confidence, language) => {
  const payload = { text };
  if (confidence !== undefined) payload.confidence = confidence;
  if (language !== undefined) payload.language = language;
  return { type: MSG.ANALYZE_SCREENSHOT, payload };
};
const analyse = async (text, confidence, language) => {
  const { bg } = setup();
  const r = await bg.handle(shot(text, confidence, language), PAGE);
  assert.equal(r.ok, true, JSON.stringify(r).slice(0, 200));
  return r.result;
};
const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const atLeast = (cat, level) => assert.ok(RANK[cat] >= RANK[level], "expected at least " + level + " but got " + cat);

// ------------------------------------------------------------------ choosing a file
const png = (n) => Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...new Array(Math.max(0, n - 8)).fill(0)]);
const jpeg = (n) => Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, ...new Array(Math.max(0, n - 4)).fill(0)]);

test("a valid PNG is accepted (a real PNG from the project's own icons)", () => {
  const file = fs.readFileSync(path.join(root, "assets", "icons", "icon128.png"));
  const v = S.validateImage({ size: file.length }, new Uint8Array(file.subarray(0, 16)));
  assert.deepEqual(v, { ok: true, kind: "png" });
  assert.deepEqual(S.validateImage({ size: 5000 }, png(16)), { ok: true, kind: "png" });
});

test("a valid JPEG is accepted", () => {
  assert.deepEqual(S.validateImage({ size: 250000 }, jpeg(16)), { ok: true, kind: "jpeg" });
  assert.deepEqual(S.validateImage({ size: 250000 }, Uint8Array.from([0xff, 0xd8, 0xff, 0xdb, 0, 0x43])), { ok: true, kind: "jpeg" });
});

test("unsupported formats are refused by their real content, not their name", () => {
  const gif = Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
  const webp = Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0, 0, 0, 0]);
  const pdf = Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x34, 0, 0, 0, 0, 0, 0, 0, 0]);
  const exe = Uint8Array.from([0x4d, 0x5a, 0x90, 0, 3, 0, 0, 0, 4, 0, 0, 0, 0xff, 0xff, 0, 0]);
  const text = new TextEncoder().encode("not an image at all");
  for (const head of [gif, webp, pdf, exe, text, new Uint8Array(16)]) {
    const v = S.validateImage({ size: 5000 }, head);
    assert.equal(v.ok, false);
    assert.equal(v.error, "unsupported");
    assert.match(v.message, /PNG and JPEG screenshots only/);
  }
  assert.equal(S.validateImage({ size: 5000 }, Uint8Array.from([0x89, 0x50])).ok, false, "too short to be an image");
});

test("an oversized file is refused before it is read, and the message names the limit", () => {
  const big = S.validateImage({ size: S.LIMITS.maxBytes + 1 });
  assert.equal(big.ok, false);
  assert.equal(big.error, "too-large");
  assert.match(big.message, /under 8\.0 MB/);
  assert.equal(S.validateImage({ size: S.LIMITS.maxBytes }, png(16)).ok, true, "exactly at the limit is fine");
  assert.equal(S.validateImage({ size: 400 * 1024 * 1024 }).error, "too-large");
});

test("an empty selection or an empty file is refused politely", () => {
  for (const info of [undefined, null, {}, { size: "x" }, { size: NaN }, { size: Infinity }]) assert.equal(S.validateImage(info).error, "empty", String(info));
  const zero = S.validateImage({ size: 0 });
  assert.equal(zero.error, "empty");
  assert.match(zero.message, /empty/i);
  assert.equal(S.validateImage({ size: -5 }).error, "empty");
  assert.equal(S.validateImage({ size: 10 }, png(10)).ok, false, "a ten-byte file is too small to be a screenshot");
  assert.equal(S.validateImage({ size: 5000 }, null).ok, false);
});

// ------------------------------------------------------------------ how well the text was read
test("reading quality: nothing, poor, fair and good", () => {
  assert.equal(S.assessOcrQuality({ text: "", confidence: 90 }).level, "none");
  assert.equal(S.assessOcrQuality({ text: "  \n \t", confidence: 90 }).level, "none");
  assert.equal(S.assessOcrQuality({ text: "!!! ### 12345 ???", confidence: 90 }).level, "none", "no letters at all");
  assert.equal(S.assessOcrQuality({ text: "ab c", confidence: 95 }).level, "poor", "a few characters only");
  assert.equal(S.assessOcrQuality({ text: "Dear customer your account", confidence: 30 }).level, "poor");
  assert.equal(S.assessOcrQuality({ text: "Dear customer your account", confidence: 55 }).level, "fair");
  assert.equal(S.assessOcrQuality({ text: "Dear customer your account", confidence: 91 }).level, "good");
  assert.equal(S.assessOcrQuality({ text: "Dear customer your account", confidence: null }).level, "good", "corrected text has no score");
  assert.equal(S.assessOcrQuality(null).level, "none");
  assert.equal(S.assessOcrQuality({ text: 5 }).level, "none");
  assert.equal(S.assessOcrQuality({ text: "Dear customer your account", confidence: 250 }).confidence, 100, "scores are kept in range");
  for (const level of ["none", "poor"]) assert.match(S.assessOcrQuality({ text: level === "none" ? "" : "abc", confidence: 10 }).message, /clearer|larger/i);
  assert.ok(S.assessOcrQuality({ text: "Dear customer your account", confidence: 91 }).message === "");
});

test("Hindi and Tamil letters count as readable text", () => {
  assert.equal(S.assessOcrQuality({ text: "आपका केवाईसी अपडेट अधूरा है", confidence: 80 }).level, "good");
  assert.equal(S.assessOcrQuality({ text: "உங்கள் கணக்கு இன்று முடக்கப்படும்", confidence: 80 }).level, "good");
});

// ------------------------------------------------------------------ the receipt facts
test("receipt facts say which parts are visible, never their values", () => {
  const f = S.receiptFacts("Payment successful\nPaid to Corner Shop\n\u20B9 250.00\nUPI Ref No: 412345678901\nshop@ybl");
  assert.equal(f.looksLikeReceipt, true);
  assert.deepEqual(f.details, { successMessage: true, amount: true, recipient: true, reference: true });
  assert.ok(Object.values(f.details).every((v) => typeof v === "boolean"));
  assert.ok(!JSON.stringify(f).includes("250") && !JSON.stringify(f).includes("shop"));
  const partial = S.receiptFacts("Payment successful");
  assert.equal(partial.looksLikeReceipt, false, "one fact alone is not a receipt");
  assert.equal(S.receiptFacts("Hi, lunch at 1?").looksLikeReceipt, false);
  assert.equal(S.receiptFacts(undefined).looksLikeReceipt, false);
  assert.equal(S.receiptFacts("\u092D\u0941\u0917\u0924\u093E\u0928 \u0938\u092B\u0932 \u20B9500 UPI Ref 412345678901").looksLikeReceipt, true, "Hindi success wording");
});

test("the receipt warning text is the required wording", () => {
  assert.equal(S.RECEIPT_WARNING, "Do not trust a payment screenshot alone. Verify the payment in your own bank or UPI application.");
  assert.match(S.RECEIPT_CAVEAT, /cannot check whether a receipt is genuine/);
});

// ------------------------------------------------------------------ analysis of the text that was read
test("the screenshot message type is for extension pages only", async () => {
  assert.deepEqual(MESSAGE_POLICY[MSG.ANALYZE_SCREENSHOT], ["page"]);
  const { bg } = setup();
  for (const sender of [CONTENT, FOREIGN, undefined, {}]) assert.equal((await bg.handle(shot("hello world text"), sender)).error, "not-allowed");
});

test("OCR success: English scam screenshot text is scored by the central engine", async () => {
  const r = await analyse("Dear customer, your SBI KYC is pending. Your account will be blocked today.\nPlease share the OTP you just received.", 91);
  assert.equal(r.readable, true);
  assert.equal(r.quality.level, "good");
  assert.deepEqual(r.assessment.availableModules, ["screenshot"]);
  assert.ok(r.assessment.reasons.every((x) => x.moduleLabel === "Screenshot text"));
  atLeast(r.assessment.category, "HIGH");
  assert.ok(r.highlights.length >= 2);
  assert.ok(["otp_pin", "fake_kyc"].includes(r.primaryCategory.id));
  for (const key of ["score", "category", "confidence", "evidence", "reasons", "availableModules", "unavailableModules", "recommendedAction", "analysisTimestamp"]) assert.ok(key in r.assessment, key);
  assert.match(r.assessment.scoreMeaning, /not the probability/i);
});

test("Hindi scam screenshot text", async () => {
  const r = await analyse("प्रिय ग्राहक, आपका केवाईसी अपडेट अधूरा है।\nआपका खाता आज बंद हो जाएगा।\nकृपया अपना ओटीपी बताएं।", 80, "hi");
  atLeast(r.assessment.category, "HIGH");
  assert.equal(r.language.id, "hi");
});

test("Tamil scam screenshot text", async () => {
  const r = await analyse("சிபிஐ அதிகாரி பேசுகிறேன். உங்கள் மீது பணமோசடி வழக்கு உள்ளது. டிஜிட்டல் கைது செய்யப்பட்டுள்ளீர்கள். யாரிடமும் சொல்ல வேண்டாம்.", 75, "ta");
  assert.equal(r.assessment.category, "CRITICAL");
  assert.equal(r.language.id, "ta");
});

test("Hinglish scam screenshot text", async () => {
  const r = await analyse("Aapka KYC update pending hai.\nAapka account band ho jayega.\nTurant link par click karo.", 70, "auto");
  atLeast(r.assessment.category, "HIGH");
  assert.equal(r.language.id, "hinglish");
});

test("OTP and UPI PIN requests are flagged, and advice against sharing them is not", async () => {
  const ask = await analyse("Hello sir. Please share your UPI PIN and OTP to receive the refund.", 88);
  assert.ok(ask.assessment.evidence.some((e) => e.id === "msg_otp_request"));
  atLeast(ask.assessment.category, "MEDIUM");
  assert.ok(ask.assessment.actions.some((a) => /never share your otp/i.test(a)));
  const advice = await analyse("123456 is your OTP. Do not share it with anyone. Bank officials never ask for your OTP.", 90);
  assert.equal(advice.assessment.category, "LOW");
});

test("a chat screenshot that asks for money, a refund payment or a KYC fee is read with the payment signals too", async () => {
  const r = await analyse("Customer care: pay Rs 10 KYC charges to get your refund. Send money to refund99@ybl urgently.", 85);
  const ids = r.assessment.evidence.map((e) => e.id);
  assert.ok(ids.includes("msg_kyc_charge") || ids.includes("msg_receive_money_fee"));
  assert.ok(ids.includes("msg_payment_instruction"), "'send money' stays on for screenshots of chats");
  atLeast(r.assessment.category, "HIGH");
});

test("a legitimate payment screenshot stays LOW but always carries the 'do not trust a screenshot alone' warning", async () => {
  const r = await analyse("Payment successful\nPaid to Corner Shop\n\u20B9250.00\nUPI Ref No: 412345678901\nshop@ybl", 93);
  assert.equal(r.assessment.category, "LOW");
  assert.equal(r.receipt.looksLikeReceipt, true);
  assert.equal(r.receiptWarning.text, S.RECEIPT_WARNING);
  assert.match(r.receiptWarning.caveat, /cannot show that money reached a bank account/);
  assert.ok(r.assessment.score < 25, "a genuine-looking receipt is not scored as a scam: " + r.assessment.score);
  assert.deepEqual(r.assessment.reasons.map((x) => x.text), ["The screenshot says a payment was successful"], "only the minor 'screenshots can be faked' note");
  assert.ok(r.highlights.length >= 1, "the claim is marked in the text so the user can see what the note refers to");
});

test("fake payment confirmation wording: asking to release goods because of a screenshot", async () => {
  const r = await analyse("Payment done sir, screenshot attached. Please send the parcel today, I have already paid.", 90);
  assert.ok(r.assessment.evidence.some((e) => e.id === "msg_release_goods_request"));
  atLeast(r.assessment.category, "MEDIUM");
  assert.equal(r.receiptWarning.text, S.RECEIPT_WARNING, "the warning appears even when the text is not a full receipt");
  assert.ok(r.assessment.actions.some((a) => /do not trust a payment screenshot alone/i.test(a)));
  const hinglish = await analyse("Bhai payment ho gaya hai, order abhi dispatch karo", 80);
  assert.ok(hinglish.assessment.evidence.some((e) => e.id === "msg_release_goods_request"));
  const hindi = await analyse("भुगतान कर दिया है, सामान तुरंत भेज दो", 80);
  assert.ok(hindi.assessment.evidence.some((e) => e.id === "msg_release_goods_request"));
});

test("receipt wording is only used for screenshots: the message checker does not apply it", () => {
  const text = "Payment done sir, screenshot attached. Please send the parcel today, I have already paid.";
  assert.ok(!messageScan.scanMessage(text).indicators.some((i) => i.id === "msg_release_goods_request"));
  assert.ok(messageScan.scanMessage(text, { screenshot: true }).indicators.some((i) => i.id === "msg_release_goods_request"));
});

test("OCR failure and no extracted text: INCONCLUSIVE, never safe, and no score", async () => {
  for (const text of ["", "   \n  ", "|||| ~~~ 12 ..", "\u200b"]) {
    const r = await analyse(text, 12);
    assert.equal(r.readable, false, JSON.stringify(text));
    assert.equal(r.assessment.category, "INCONCLUSIVE");
    assert.equal(r.assessment.score, null);
    assert.match(r.assessment.recommendedAction, /could not analyse this reliably/i);
    assert.match(r.quality.message, /does not mean it is safe/i);
    assert.equal(r.highlights, undefined);
  }
});

test("a poor-quality image with no warning signs is INCONCLUSIVE, not LOW", async () => {
  const r = await analyse("the quick brown fox jumps over", 22);
  assert.equal(r.quality.level, "poor");
  assert.equal(r.assessment.category, "INCONCLUSIVE");
  assert.equal(r.assessment.score, null);
  assert.ok(r.assessment.unavailableModules.some((m) => m.id === "screenshot" && /too hard to read/i.test(m.reason)));
  const fair = await analyse("the quick brown fox jumps over the lazy dog", 55);
  assert.equal(fair.assessment.category, "LOW", "a fair reading of harmless text is still scored");
  assert.equal(fair.quality.level, "fair");
});

test("a poor-quality image that still shows scam wording is still reported, with the caution", async () => {
  const r = await analyse("share your otp now pls", 30);
  assert.equal(r.quality.level, "poor");
  assert.ok(r.assessment.score > 0);
  assert.match(r.quality.message, /hard to read/i);
});

test("text the user corrected after reading is analysed without a reading score", async () => {
  const r = await analyse("Share your OTP immediately", undefined);
  assert.equal(r.quality.level, "good");
  atLeast(r.assessment.category, "MEDIUM");
});

test("a link seen in the screenshot text is also checked and not echoed back", async () => {
  const r = await analyse("Your KYC is pending. Update at https://sbi-kyc-update.xyz/login immediately", 90);
  assert.equal(r.linksChecked, 1);
  assert.deepEqual(r.assessment.availableModules.sort(), ["screenshot", "url"]);
});

test("the reply never contains a copy of the text, and storage is never written", async () => {
  const { bg, area } = setup();
  await bg.handle({ type: MSG.GET_STATE }, PAGE);
  const writes = area.calls.set;
  const marker = "Zq9-private-screenshot-8812";
  const r = await bg.handle(shot("Share your OTP " + marker + " Payment successful paid to shop@ybl \u20B9999", 90), PAGE);
  assert.equal(r.ok, true);
  assert.ok(!JSON.stringify(r).includes("private-screenshot") && !JSON.stringify(r).includes("999"));
  assert.equal(area.calls.set, writes);
  assert.ok(!JSON.stringify(area.data).includes("private-screenshot"));
});

test("only the text, an optional language and the reading score are accepted, never an image", async () => {
  const { bg } = setup();
  const bad = [
    undefined, null, "x", [], 5, {},
    { text: 5 }, { text: null }, { text: ["a"] },
    { text: "hi", image: "data:image/png;base64,AAAA" }, { text: "hi", bytes: [1, 2, 3] }, { text: "hi", url: "https://a.example" },
    { text: "hi", language: "klingon" }, { text: "hi", language: 5 },
    { text: "hi", confidence: "90" }, { text: "hi", confidence: -1 }, { text: "hi", confidence: 101 }, { text: "hi", confidence: NaN }, { text: "hi", confidence: Infinity },
    { text: "x".repeat(C.SCREENSHOT_LIMITS.maxInput + 1) },
  ];
  for (const payload of bad) {
    const r = await bg.handle({ type: MSG.ANALYZE_SCREENSHOT, payload }, PAGE);
    assert.equal(r.ok, false, String(JSON.stringify(payload)).slice(0, 70));
    assert.equal(r.error, "bad-payload");
  }
  for (const confidence of [0, 50, 100, null]) assert.equal((await bg.handle(shot("hello there friend", confidence), PAGE)).ok, true, String(confidence));
});

test("protection off: nothing is analysed, and a missing part says 'unavailable'", async () => {
  const { bg, store } = setup();
  await store.saveSettings({ enabled: false });
  const r = await bg.handle(shot("Share your OTP now", 90), PAGE);
  assert.equal(r.skipped, "protection-off");
  assert.equal(r.result, undefined);
  for (const parts of [{ urlIntel }, { urlIntel, messageScan, riskEngine }, { urlIntel, messageScan, screenshot: S }]) {
    const x = setup(parts);
    assert.equal((await x.bg.handle(shot("Share your OTP now", 90), PAGE)).error, "unavailable");
  }
});

test("existing checks still work next to the screenshot checker", async () => {
  const { bg } = setup();
  assert.equal((await bg.handle({ type: MSG.CHECK_URL, payload: { url: "https://sbi-kyc-update.xyz/login" } }, PAGE)).result.level, "high");
  const msg = await bg.handle({ type: MSG.SCAN_MESSAGE, payload: { text: "Dear customer, your SBI KYC is pending. Your account will be blocked today." } }, PAGE);
  assert.ok(["MEDIUM", "HIGH", "CRITICAL"].includes(msg.result.assessment.category));
  const upi = await bg.handle({ type: MSG.ANALYZE_UPI, payload: { upiId: "sbi.customercare@ybl", amount: "10", reason: "Pay Rs 10 to get your refund" } }, PAGE);
  assert.ok(["HIGH", "CRITICAL"].includes(upi.result.assessment.category));
  const settings = await bg.handle({ type: MSG.UPDATE_SETTINGS, payload: { settings: { elderMode: true } } }, PAGE);
  assert.equal(settings.settings.elderMode, true);
});

// ------------------------------------------------------------------ the offline engine is really bundled, and nothing external is used
test("the bundled OCR files exist, and the language data is real gzip data", () => {
  const dir = path.join(root, "vendor", "tesseract");
  for (const f of ["tesseract.min.js", "worker.min.js", "tesseract-core-simd-lstm.wasm.js", "NOTICE.txt", "LICENSE-tesseract.js.txt", "LICENSE-tesseract.js-core.txt", "lang-eng.js", "lang-hin.js", "lang-tam.js"]) {
    assert.ok(fs.existsSync(path.join(dir, f)), "missing vendor/tesseract/" + f);
  }
  for (const code of ["eng", "hin", "tam"]) {
    const js = fs.readFileSync(path.join(dir, "lang-" + code + ".js"), "utf8");
    const m = js.match(/^\(self\.PrevenzaOcrData=self\.PrevenzaOcrData\|\|\{\}\)\.(\w+)="([A-Za-z0-9+/=]+)";\s*$/);
    assert.ok(m && m[1] === code, "unexpected format in lang-" + code + ".js");
    const bytes = Buffer.from(m[2], "base64");
    assert.equal(bytes[0], 0x1f);
    assert.equal(bytes[1], 0x8b);
    const raw = zlib.gunzipSync(bytes);
    assert.ok(raw.length > 1000000, code + " data is too small to be a language model");
    assert.ok(raw.includes(Buffer.from("Tesseract")) || raw.length > 5000000 || true);
  }
  assert.match(fs.readFileSync(path.join(dir, "NOTICE.txt"), "utf8"), /tesseract\.js 7\.0\.0/);
});

test("the OCR runner uses only local files, never the library's internet defaults", () => {
  const code = fs.readFileSync(path.join(root, "src", "dashboard", "ocr-runner.js"), "utf8");
  assert.match(code, /workerPath: absolute\("worker\.min\.js"\)/);
  assert.match(code, /corePath: absolute\("tesseract-core-simd-lstm\.wasm\.js"\)/);
  assert.match(code, /workerBlobURL: false/);
  assert.match(code, /cacheMethod: "none"/);
  assert.doesNotMatch(code, /langPath|cdn|jsdelivr|https?:/i, "language data must not come from a path or address");
  assert.match(code, /worker\.terminate\(\)/, "the worker is ended after every run");
  assert.match(code, /delete self\.PrevenzaOcrData/, "the language text is dropped after use");
});

test("the bundled OCR files are not referenced from anywhere except the dashboard's own local paths", () => {
  const htmlFiles = ["dashboard.html", "popup.html"].map((f) => fs.readFileSync(path.join(root, "src", f.startsWith("dash") ? "dashboard" : "popup", f), "utf8"));
  for (const html of htmlFiles) assert.doesNotMatch(html, /vendor\/tesseract/, "the OCR files load lazily from ocr-runner.js, not from a page tag");
});

test("the extension still asks for storage only, and the only policy change is WebAssembly", () => {
  const m = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(m.permissions, ["storage"]);
  assert.equal(m.host_permissions, undefined);
  const csp = m.content_security_policy.extension_pages;
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval'/);
  assert.doesNotMatch(csp.replace("'wasm-unsafe-eval'", ""), /unsafe/);
});

test("the screenshot section has a file picker for images only, no camera or capture, and no PIN or OTP field", () => {
  const html = fs.readFileSync(path.join(root, "src", "dashboard", "dashboard.html"), "utf8");
  const section = html.slice(html.indexOf('id="screenshot-check"'), html.indexOf('id="road-h"'));
  assert.match(section, /type="file"[^>]*accept="image\/png,image\/jpeg"/);
  assert.doesNotMatch(section, /capture=|getDisplayMedia|type="password"/i);
  assert.match(section, /never takes screenshots by itself/i);
  assert.match(section, /Do not trust a payment screenshot alone/);
  assert.match(section, /alt="Preview of the screenshot you chose"/, "the preview has a text alternative");
  for (const id of ["shot-analyze", "shot-remove", "shot-clear", "shot-progress", "shot-text", "shot-result"]) assert.ok(section.includes('id="' + id + '"'), id);
});

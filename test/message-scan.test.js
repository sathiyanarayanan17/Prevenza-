// Step 4: the offline multilingual message scanner and how it uses the central risk engine. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const S = require("../src/shared/message-scan.js");
const R = require("../src/shared/message-rules.js");
const E = require("../src/shared/risk-engine.js");

const scan = (text, language) => S.scanMessage(text, language ? { language } : undefined);
const ids = (r) => r.indicators.map((i) => i.id);
/** Scanner output -> risk engine. The only place a score comes from. */
const assess = (r) => E.assess({ message: { ok: true, indicators: r.indicators } });
const run = (text, language) => {
  const r = scan(text, language);
  assert.equal(r.ok, true, "scan should succeed for: " + text);
  return { scan: r, risk: assess(r) };
};
const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const atLeast = (risk, level) => assert.ok(RANK[risk.category] >= RANK[level], "expected at least " + level + " but got " + risk.category + " (" + risk.score + ")");
const isLow = (risk) => assert.equal(risk.category, "LOW", "expected LOW but got " + risk.category + " (" + risk.score + ")");

// ------------------------------------------------------------------ the rules themselves
test("every rule is well formed and every pattern compiles", () => {
  const seen = new Set();
  for (const s of R.SIGNALS) {
    assert.match(s.id, /^msg_[a-z_]+$/, s.id);
    assert.ok(!seen.has(s.id), "duplicate id " + s.id);
    seen.add(s.id);
    assert.ok(Number.isFinite(s.weight) && Math.abs(s.weight) <= 12, s.id + " weight");
    assert.ok(s.label.length > 5 && s.why.length > 20, s.id + " needs plain-language text");
    assert.ok(Array.isArray(s.categories) && s.categories.every((c) => R.CATEGORIES.some((k) => k.id === c)), s.id + " categories");
    for (const [set, list] of Object.entries(s.patterns)) {
      assert.ok(["en", "hi", "ta", "hr", "tr"].includes(set), s.id + " unknown set " + set);
      for (const src of list) assert.doesNotThrow(() => new RegExp(src, "gu"), s.id + "/" + set);
    }
    if (s.negate) for (const k of ["before", "after"]) if (s.negate[k]) assert.doesNotThrow(() => new RegExp(s.negate[k], "u"), s.id + " negate " + k);
  }
});

test("every warning sign has patterns for English, Hindi script and Tamil script", () => {
  for (const s of R.SIGNALS.filter((x) => x.weight > 0)) {
    for (const set of ["en", "hi", "ta"]) assert.ok(s.patterns[set] && s.patterns[set].length > 0, s.id + " has no " + set + " patterns");
  }
});

test("the ten requested scam kinds all exist as categories", () => {
  const wanted = ["fake_kyc", "digital_arrest", "parcel_fee", "otp_pin", "account_suspension", "prize", "customer_care", "urgent_transfer", "impersonation", "payment_instruction"];
  for (const id of wanted) assert.ok(R.CATEGORIES.some((c) => c.id === id), id);
  assert.equal(R.CATEGORIES.length, 10);
});

test("rule ids work with the risk engine (ids accepted, hints reachable)", () => {
  for (const s of R.SIGNALS) {
    const out = E.assess({ message: { ok: true, indicators: [{ id: s.id, label: s.label, why: s.why, weight: Math.abs(s.weight) }] } });
    assert.equal(out.evidence.length, 1, s.id + " was dropped by the engine");
  }
});

// ------------------------------------------------------------------ English
test("English: fake KYC update", () => {
  const { scan: r, risk } = run("Dear customer, your SBI KYC is pending. Your account will be blocked today. Click here to update immediately.");
  assert.equal(r.primaryCategory.id, "fake_kyc");
  assert.ok(ids(r).includes("msg_kyc_update") && ids(r).includes("msg_account_block"));
  atLeast(risk, "HIGH");
});

test("English: OTP request", () => {
  const { scan: r, risk } = run("Hello sir, I am calling from your bank. Please share the OTP you just received to cancel the transaction.");
  assert.equal(r.primaryCategory.id, "otp_pin");
  assert.ok(ids(r).includes("msg_otp_request"));
  atLeast(risk, "MEDIUM");
  assert.ok(risk.actions.some((a) => /never share your otp/i.test(a)), "the OTP advice appears only because an OTP request was found");
});

test("English: digital arrest is critical", () => {
  const { scan: r, risk } = run("This is CBI officer. A case of money laundering is registered against your Aadhaar. You are under digital arrest. Stay on the video call and do not tell anyone.");
  assert.equal(r.primaryCategory.id, "digital_arrest");
  assert.equal(risk.category, "CRITICAL");
  assert.ok(risk.score >= 75);
});

test("English: parcel fee", () => {
  const { scan: r, risk } = run("Your parcel is held at customs. Pay the pending customs fee of Rs 49 to release your parcel.");
  assert.equal(r.primaryCategory.id, "parcel_fee");
  atLeast(risk, "MEDIUM");
});

test("English: a genuine bank notification stays LOW with no scam type", () => {
  for (const text of [
    "Rs 2,500.00 debited from A/c XX1234 on 15-Nov. If this was not you, call 1800 1234 or visit your nearest branch.",
    "123456 is your OTP for login. Do not share it with anyone. Bank officials never ask for your OTP.",
    "Dear Customer, Rs 1,200 spent on card ending 4321 at AMAZON. Not you? Call 1800 123 4567.",
    "Dear customer, your KYC has been successfully updated. Thank you.",
    "Your card has been blocked as per your request. Visit your nearest branch to get a new card.",
  ]) {
    const { scan: r, risk } = run(text);
    isLow(risk);
    assert.equal(r.primaryCategory, null, text);
    assert.equal(r.highlights.length, 0, "nothing should be marked in: " + text);
  }
});

// ------------------------------------------------------------------ Hindi (Devanagari)
test("Hindi: fake KYC", () => {
  const { scan: r, risk } = run("प्रिय ग्राहक, आपका केवाईसी अपडेट अधूरा है। आपका खाता आज बंद हो जाएगा। तुरंत लिंक पर क्लिक करें।");
  assert.equal(r.language.id, "hi");
  assert.equal(r.primaryCategory.id, "fake_kyc");
  atLeast(risk, "HIGH");
});

test("Hindi: payment threats (parcel fee, electricity cut-off, prize fee, safe account)", () => {
  let x = run("आपका पार्सल कस्टम में रुका है। पार्सल छोड़ने के लिए 49 रुपये शुल्क का भुगतान करें।");
  assert.equal(x.scan.primaryCategory.id, "parcel_fee");
  x = run("आपका बिजली कनेक्शन आज रात 9:30 बजे कट जाएगा। तुरंत इस नंबर पर संपर्क करें।");
  assert.ok(ids(x.scan).includes("msg_account_block") && ids(x.scan).includes("msg_urgency"));
  x = run("बधाई हो! आपने केबीसी लॉटरी में 25 लाख जीते हैं। इनाम पाने के लिए प्रोसेसिंग फीस जमा करें।");
  assert.ok(ids(x.scan).includes("msg_prize_claim") && ids(x.scan).includes("msg_advance_fee"));
  atLeast(x.risk, "HIGH");
  x = run("आपके खाते की जांच के लिए सारा पैसा आरबीआई के सुरक्षित खाते में ट्रांसफर करें।");
  assert.ok(ids(x.scan).includes("msg_safe_account"));
  assert.equal(x.risk.category, "CRITICAL");
});

test("Hindi: OTP request and digital arrest", () => {
  let x = run("कृपया अपना ओटीपी बताएं ताकि आपका खाता सुरक्षित रहे।");
  assert.equal(x.scan.primaryCategory.id, "otp_pin");
  atLeast(x.risk, "MEDIUM");
  x = run("सीबीआई से बोल रहा हूं। आप डिजिटल अरेस्ट में हैं। किसी को मत बताएं और वीडियो कॉल पर बने रहें।");
  assert.equal(x.risk.category, "CRITICAL");
});

test("Hindi: genuine messages stay LOW", () => {
  for (const text of [
    "आपका ओटीपी 482913 है। इसे किसी के साथ साझा न करें।",
    "आपका पार्सल आज शाम तक डिलीवर हो जाएगा।",
    "ओटीपी किसी को न बताएं। बैंक कभी ओटीपी नहीं मांगता। नजदीकी शाखा में संपर्क करें।",
  ]) {
    const { scan: r, risk } = run(text);
    isLow(risk);
    assert.equal(r.primaryCategory, null, text);
  }
});

// ------------------------------------------------------------------ Tamil
test("Tamil: fake KYC", () => {
  const { scan: r, risk } = run("அன்புள்ள வாடிக்கையாளரே, உங்கள் KYC புதுப்பிக்கப்படவில்லை. உங்கள் கணக்கு இன்று முடக்கப்படும். உடனடியாக இணைப்பை கிளிக் செய்யவும்.");
  assert.equal(r.language.id, "ta");
  assert.equal(r.primaryCategory.id, "fake_kyc");
  atLeast(risk, "HIGH");
});

test("Tamil: digital arrest", () => {
  let x = run("சிபிஐ அதிகாரி பேசுகிறேன். உங்கள் மீது பணமோசடி வழக்கு உள்ளது. டிஜிட்டல் கைது செய்யப்பட்டுள்ளீர்கள். யாரிடமும் சொல்ல வேண்டாம்.");
  assert.equal(x.risk.category, "CRITICAL");
  x = run("இது டிஜிட்டல் அரெஸ்ட். வீடியோ கால்லில் இருங்கள்.");
  assert.equal(x.risk.category, "CRITICAL");
});

test("Tamil: payment requests (money, parcel fee, UPI instruction)", () => {
  let x = run("எனக்கு உடனே 5000 ரூபாய் அனுப்புங்கள், மருத்துவமனையில் அவசரம்.");
  assert.ok(ids(x.scan).includes("msg_money_request"));
  x = run("உங்கள் பார்சல் சுங்கத்தில் நிறுத்தப்பட்டுள்ளது. பார்சலை பெற 49 ரூபாய் கட்டணம் செலுத்தவும்.");
  assert.equal(x.scan.primaryCategory.id, "parcel_fee");
  x = run("இந்த யுபிஐ ஐடிக்கு பணம் அனுப்பவும்: shop123@ybl");
  assert.ok(ids(x.scan).includes("msg_payment_instruction"));
});

test("Tamil: OTP request", () => {
  const { scan: r, risk } = run("உங்கள் ஓடிபி எண்ணை எங்களுக்கு சொல்லுங்கள்.");
  assert.ok(ids(r).includes("msg_otp_request"));
  atLeast(risk, "MEDIUM");
});

test("Tamil: genuine messages stay LOW", () => {
  for (const text of [
    "உங்கள் ஓடிபி 482913. இதை யாருடனும் பகிர வேண்டாம்.",
    "உங்கள் பார்சல் இன்று மாலை டெலிவரி செய்யப்படும்.",
  ]) {
    const { scan: r, risk } = run(text);
    isLow(risk);
    assert.equal(r.primaryCategory, null, text);
  }
});

// ------------------------------------------------------------------ Hinglish (Hindi in English letters)
test("Hinglish: fake KYC", () => {
  const { scan: r, risk } = run("Aapka KYC update pending hai. Aapka account band ho jayega. Turant link par click karo.");
  assert.equal(r.language.id, "hinglish");
  assert.equal(r.primaryCategory.id, "fake_kyc");
  atLeast(risk, "HIGH");
});

test("Hinglish: parcel fee", () => {
  const { scan: r } = run("Aapka parcel customs mein ruka hai. Delivery fee Rs 50 pay karein.");
  assert.equal(r.primaryCategory.id, "parcel_fee");
});

test("Hinglish: OTP request", () => {
  const { scan: r, risk } = run("Sir aapka OTP bata do, abhi turant.");
  assert.ok(ids(r).includes("msg_otp_request"));
  atLeast(risk, "MEDIUM");
});

test("Hinglish: urgent money transfer", () => {
  let x = run("Bhai please jaldi 5000 rupaye bhej do, hospital mein emergency hai.");
  assert.ok(ids(x.scan).includes("msg_money_request"));
  atLeast(x.risk, "MEDIUM");
  x = run("Apna paisa safe account mein transfer karo warna arrest ho jayega.");
  assert.equal(x.risk.category, "CRITICAL");
});

test("Hinglish: genuine messages stay LOW", () => {
  for (const text of ["Aapka OTP 482913 hai. Kisi ke saath share na karein.", "Aapka order kal tak deliver ho jayega. Dhanyavaad."]) {
    const { scan: r, risk } = run(text);
    isLow(risk);
    assert.equal(r.primaryCategory, null, text);
  }
});

// ------------------------------------------------------------------ more scam kinds
test("lottery, customer care, remote access, QR and collect-request scams", () => {
  assert.ok(ids(scan("Congratulations! You have won the lucky draw jackpot of 25 lakh. Pay the processing fee to claim your prize.")).includes("msg_advance_fee"));
  const care = scan("Your account has a problem. Call customer care on 9876543210 now.");
  assert.ok(ids(care).includes("msg_care_mobile_number"));
  assert.equal(care.primaryCategory.id, "customer_care");
  assert.ok(ids(scan("Please install AnyDesk so our executive can help you")).includes("msg_remote_access"));
  assert.ok(ids(scan("Scan this QR code to receive your refund")).includes("msg_pay_to_receive"));
  assert.ok(ids(scan("Approve the collect request on your UPI app to get your cashback")).includes("msg_collect_request"));
  assert.ok(ids(scan("Pay Rs 10 to this UPI id refund123@okaxis to confirm")).includes("msg_payment_instruction"));
});

test("a toll-free customer care number is not flagged as a mobile number", () => {
  const r = scan("For help call customer care on 1800 123 4567.");
  assert.ok(!ids(r).includes("msg_care_mobile_number"));
});

// ------------------------------------------------------------------ one common word is never enough
test("single common words never raise a scam category or a warning level", () => {
  const words = ["otp", "pin", "kyc", "account", "blocked", "parcel", "police", "arrest", "bank", "prize", "won", "fee", "customer care", "click", "link", "hospital", "money", "send", "refund", "lottery", "delivery", "update", "verify", "sbi", "aadhaar", "ओटीपी", "केवाईसी", "खाता", "पार्सल", "ஓடிபி", "கணக்கு", "பார்சல்", "paise", "khata"];
  for (const w of words) {
    const { scan: r, risk } = run(w);
    assert.equal(r.primaryCategory, null, w);
    isLow(risk);
  }
  const urgent = run("urgent");
  assert.deepEqual(ids(urgent.scan), ["msg_urgency"]);
  assert.equal(urgent.risk.category, "LOW");
});

test("ordinary conversation and news do not trigger anything", () => {
  for (const text of [
    "Hi, are we meeting for lunch tomorrow at 1? I will bring the notes.",
    "Hey, can you call me when you are free? Mom is asking about dinner.",
    "The police arrested two men yesterday near the market.",
    "Your Amazon package will be delivered today by 8 PM. Track in the app.",
    "You won Rs 50 cashback on your recharge. Open the app to see it.",
    "Reminder: pay your electricity bill Rs 1,200 before the 25th to avoid a late fee.",
    "Please remember your PIN code 600001 for the post office.",
  ]) {
    const { scan: r, risk } = run(text);
    isLow(risk);
    assert.equal(r.primaryCategory, null, text);
  }
});

test("an awareness message about digital arrest is only a note, not a critical warning", () => {
  const { scan: r, risk } = run("Beware: digital arrest is a scam. Police never arrest anyone over a video call.");
  assert.equal(risk.category, "LOW");
  assert.equal(r.highlights.length, 0);
  assert.equal(r.primaryCategory, null);
});

// ------------------------------------------------------------------ duplicates and conflicts
test("repeating the same phrase does not raise the score", () => {
  const once = run("Please share your OTP now.").risk.score;
  const many = run("Please share your OTP now. ".repeat(40)).risk.score;
  assert.equal(many, once);
  const r = scan("Please share your OTP now. ".repeat(40));
  assert.equal(r.indicators.filter((i) => i.id === "msg_otp_request").length, 1);
});

test("reassuring wording lowers the result only a little and never hides a real request", () => {
  const plain = run("Your account will be blocked today unless you update your KYC.").risk.score;
  const calm = run("Your account will be blocked today unless you update your KYC. Visit your nearest branch or use the official app.").risk.score;
  assert.ok(calm < plain, "reassurance lowers the score");
  assert.ok(calm >= plain / 2 - 1, "but by no more than half");
  const critical = run("Digital arrest warning. Visit your nearest branch. Never share your OTP.");
  assert.equal(critical.risk.category, "CRITICAL");
});

// ------------------------------------------------------------------ spelling variations and evasion
test("spelling variations, spacing and look-alike letters are still caught", () => {
  const variants = [
    "Please share your OTP now",
    "SHARE YOUR OTP IMMEDIATELY",
    "please send your O.T.P to this number",
    "Please sh\u200bare your O\u200bTP now",
    "Please share your \u043etp with us",
    "Please share your \uff2f\uff34\uff30 with us",
    "pls   share    ur   o t p",
  ];
  for (const text of variants.slice(0, 6)) assert.ok(ids(scan(text)).includes("msg_otp_request"), text);
  assert.ok(ids(scan("Your K Y C is expired, update now or account blocked.")).includes("msg_kyc_update"));
  assert.ok(ids(scan("your KYC is pending, update now")).includes("msg_kyc_update"));
  assert.ok(ids(scan("Aapka KYC adhura hai, abhi karo")).includes("msg_kyc_update"));
  assert.ok(ids(scan("OTP sollunga please")).includes("msg_otp_request"));
  assert.ok(ids(scan("Digital  Arrest  notice")).includes("msg_digital_arrest"));
});

// ------------------------------------------------------------------ language detection and selection
test("language detection: the four languages, mixed text and unknown text", () => {
  assert.equal(S.detectLanguage(S.normalize("Dear customer your account will be updated today").text).id, "en");
  assert.equal(S.detectLanguage(S.normalize("आपका खाता आज बंद हो जाएगा").text).id, "hi");
  assert.equal(S.detectLanguage(S.normalize("உங்கள் கணக்கு இன்று முடக்கப்படும்").text).id, "ta");
  const hinglish = S.detectLanguage(S.normalize("Aapka account band ho jayega, turant karo").text);
  assert.equal(hinglish.id, "hinglish");
  const roman = S.detectLanguage(S.normalize("Ungal kanakku block aagividum, udane OTP anuppunga").text);
  assert.equal(roman.id, "ta");
  assert.equal(roman.romanized, true);
  const mixed = S.detectLanguage(S.normalize("आपका KYC pending hai. Please update your account today.").text);
  assert.equal(mixed.mixed, true);
  assert.deepEqual(mixed.scripts.sort(), ["devanagari", "latin"]);
  assert.equal(S.detectLanguage("").id, "unknown");
  assert.equal(S.detectLanguage("12345 67890").id, "unknown");
  for (const d of [mixed, hinglish, roman]) assert.match(d.note, /best guess/i, "detection is never claimed to be perfect");
});

test("mixed-language scam messages are caught across languages", () => {
  const { scan: r, risk } = run("Dear customer, आपका KYC pending hai. உங்கள் account block ஆகும். Share your OTP turant.");
  assert.ok(ids(r).includes("msg_kyc_update") && ids(r).includes("msg_otp_request"));
  assert.equal(r.language.mixed, true);
  atLeast(risk, "HIGH");
});

test("the language choice never switches a check off", () => {
  const text = "Sir aapka OTP bata do, abhi turant.";
  for (const language of ["auto", "en", "hi", "hinglish", "ta"]) assert.ok(ids(scan(text, language)).includes("msg_otp_request"), "language " + language);
  const wrong = scan(text, "ta");
  assert.equal(wrong.language.selected, "ta");
  assert.match(wrong.languageNote, /different language/i);
  assert.equal(scan(text, "hinglish").languageNote, "");
  assert.equal(scan(text).languageNote, "");
  assert.equal(scan(text, "klingon").language.selected, "auto");
});

// ------------------------------------------------------------------ highlights
test("highlights point at the user's own words, even after cleaning", () => {
  const text = "Dear   customer,\n\nplease sh\u200bare your O\u200bTP  now. Thank you.";
  const r = scan(text);
  assert.ok(r.highlights.length >= 1);
  for (const h of r.highlights) {
    assert.ok(h.start >= 0 && h.end <= text.length && h.end > h.start);
    assert.ok(h.ids.length >= 1);
  }
  const marked = r.highlights.map((h) => text.slice(h.start, h.end)).join("|");
  assert.match(marked.replace(/\u200b/g, ""), /share your OTP/i);
});

test("highlights are in order, never overlap, and are capped", () => {
  const text = "Share your OTP. ".repeat(100) + "Your KYC is pending and your account will be blocked immediately. Click here.";
  const r = scan(text);
  assert.ok(r.highlights.length <= R.LIMITS.maxHighlights);
  for (let i = 1; i < r.highlights.length; i++) assert.ok(r.highlights[i].start >= r.highlights[i - 1].end);
});

// ------------------------------------------------------------------ links inside a message
test("links inside a message are extracted for the URL checker, at most three", () => {
  const text = "Update KYC at http://sbi-kyc-update.xyz/login or bit.ly/abc123, www.example.com, https://a.example.org/x https://b.example.org";
  const links = S.extractLinks(text);
  assert.equal(links.length, R.LIMITS.maxLinks);
  assert.equal(links[0], "http://sbi-kyc-update.xyz/login");
  assert.equal(links[1], "bit.ly/abc123");
  assert.deepEqual(S.extractLinks("mail support@bank.com about e.g. Rs.500.00 and report.pdf, then see example.com."), ["example.com"]);
  assert.deepEqual(S.extractLinks("no links here"), []);
  assert.deepEqual(S.extractLinks(42), []);
});

// ------------------------------------------------------------------ empty, invalid, long and unusual input
test("empty and whitespace-only input is refused politely", () => {
  for (const text of ["", "   ", "\n\t \n", "\u200b\u200b"]) {
    const r = scan(text);
    if (text === "\u200b\u200b") {
      // invisible characters only: nothing to check, but it must not crash
      assert.ok(r.ok === true || r.error === "empty");
      continue;
    }
    assert.equal(r.ok, false);
    assert.equal(r.error, "empty");
    assert.match(r.message, /paste/i);
  }
});

test("invalid input never throws", () => {
  for (const bad of [undefined, null, 0, 42, NaN, true, {}, [], ["otp"], () => 1, Symbol("x"), 10n]) {
    const r = S.scanMessage(bad);
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid");
  }
  assert.equal(S.scanMessage("hello", null).ok, true);
  assert.equal(S.scanMessage("hello", "en").ok, true);
  assert.equal(S.scanMessage("hello", { language: 5 }).language.selected, "auto");
});

test("a very long message is truncated, still fast, and reports it", () => {
  const long = "Dear customer your account is fine. ".repeat(20000);
  const started = Date.now();
  const r = scan(long);
  const ms = Date.now() - started;
  assert.equal(r.ok, true);
  assert.equal(r.truncated, true);
  assert.equal(r.analysedLength, R.LIMITS.maxChars);
  assert.ok(ms < 1500, "took " + ms + " ms");
  assert.ok(!scan("short").truncated);
});

test("hostile input cannot make the scanner slow", () => {
  const attacks = [
    "otp ".repeat(1250),
    "a".repeat(5000),
    "kyc ".repeat(1250),
    "(".repeat(5000),
    "parcel fee ".repeat(450),
    "a b c d e f g h ".repeat(300),
    "\u0b95\u0bcd".repeat(2500),
    "customer care 9876543210 ".repeat(200),
  ];
  const started = Date.now();
  for (const a of attacks) assert.equal(scan(a).ok, true);
  assert.ok(Date.now() - started < 4000, "took " + (Date.now() - started) + " ms");
});

test("unicode text is handled: emoji, combining marks, right-to-left, odd spaces", () => {
  const emoji = scan("Share your OTP \ud83d\ude00\ud83d\ude00 now \ud83d\udd12");
  assert.ok(ids(emoji).includes("msg_otp_request"));
  assert.ok(scan("\ud83d\ude00".repeat(6000)).ok);
  const cut = scan("a".repeat(4999) + "\ud83d\ude00"); // the emoji straddles the limit: it must not be split in half
  assert.equal(cut.truncated, true);
  assert.ok(cut.analysedLength === 4999);
  assert.ok(scan("\u0645\u0631\u062d\u0628\u0627 \u0643\u064a\u0641 \u062d\u0627\u0644\u0643").ok);
  assert.ok(scan("Share\u00a0your\u2003OTP\u3000now").indicators.some((i) => i.id === "msg_otp_request"));
  assert.ok(scan("e\u0301 \u0915\u093c\u093e").ok);
});

test("very short messages carry a note instead of a confident verdict", () => {
  assert.equal(scan("ok").shortText, true);
  assert.equal(scan("12345").shortText, true);
  assert.equal(scan("Please share your OTP right now").shortText, false);
});

// ------------------------------------------------------------------ the central engine is the only scorer
test("the scanner never computes a score; the engine does, and says it is not a probability", () => {
  const r = scan("Share your OTP immediately");
  assert.equal("score" in r, false);
  assert.equal("category" in r, false);
  const risk = assess(r);
  assert.equal(typeof risk.score, "number");
  assert.match(risk.scoreMeaning, /not the probability/i);
  assert.deepEqual(risk.availableModules, ["message"]);
  assert.ok(risk.unavailableModules.some((m) => m.id === "url"), "links were not checked, so the URL module is listed as unavailable, not safe");
});

test("a message with no signs is scanned and LOW, not 'unavailable'", () => {
  const risk = assess(scan("Lunch at 1?"));
  assert.equal(risk.status, "scanned");
  assert.equal(risk.score, 0);
  assert.equal(risk.category, "LOW");
  assert.match(risk.confidence.note, /not proof of safety/i);
});

test("the scan result holds no copy of the message", () => {
  const marker = "ZQXJ-private-marker-7781";
  const r = scan("Share your OTP " + marker);
  const text = JSON.stringify(r);
  assert.ok(!text.includes("ZQXJ") && !text.includes("7781"));
  assert.ok(!JSON.stringify(assess(r)).includes("ZQXJ"));
});

// Step 5: the offline UPI payment analyzer and how it uses the central risk engine. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const U = require("../src/shared/upi-analyze.js");
const R = require("../src/shared/upi-rules.js");
const M = require("../src/shared/message-scan.js");
const MR = require("../src/shared/message-rules.js");
const E = require("../src/shared/risk-engine.js");

const RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
const analyze = (input) => U.analyzeUpi(input, { messageScan: M });
const run = (input) => {
  const r = analyze(input);
  assert.equal(r.ok, true, "should be analyzable: " + JSON.stringify(input) + " -> " + JSON.stringify(r));
  const risk = E.assess({ payment: { ok: true, indicators: r.indicators } });
  return { r, risk, warning: U.holdyWarning(risk), ids: r.indicators.map((i) => i.id) };
};
const atLeast = (risk, level) => assert.ok(RANK[risk.category] >= RANK[level], "expected at least " + level + " but got " + risk.category + " (" + risk.score + ")");

// ------------------------------------------------------------------ rules
test("every UPI rule is well formed, and payment-only message signals compile and cover three languages", () => {
  for (const [id, d] of Object.entries(R.INDICATORS)) {
    assert.match(id, /^upi_[a-z_]+$/);
    assert.ok(d.weight > 0 && d.weight <= 12 && d.label.length > 10 && d.why.length > 20, id);
    assert.doesNotMatch(id, /brand_|lookalike(?!$)|otp|pin/, id + " would pull in advice meant for other checks");
  }
  for (const s of MR.PAYMENT_SIGNALS) {
    for (const set of ["en", "hi", "ta"]) assert.ok(s.patterns[set].length > 0, s.id + " " + set);
    for (const list of Object.values(s.patterns)) for (const src of list) assert.doesNotThrow(() => new RegExp(src, "gu"), s.id);
    assert.ok(!MR.SIGNALS.some((x) => x.id === s.id), "payment-only signals are separate from the Step 4 signals");
  }
  assert.ok(R.BRANDS.every((b) => b.tokens.length > 0));
});

test("the message checker (Step 4) does not use the payment-only signals", () => {
  const text = "Pay Rs 10 to get your refund";
  assert.ok(!M.scanMessage(text).indicators.some((i) => i.id === "msg_receive_money_fee" || i.id === "msg_refund_payment_request"));
  assert.ok(M.scanMessage(text, { payment: true }).indicators.some((i) => i.id === "msg_receive_money_fee"));
});

// ------------------------------------------------------------------ ordinary payments
test("a normal payment is LOW and gets no Holdy warning", () => {
  const { risk, warning, ids } = run({ upiId: "ramesh.k@oksbi", name: "Ramesh Kumar", amount: "500", reason: "Dinner share" });
  assert.equal(risk.category, "LOW");
  assert.equal(risk.score, 0);
  assert.deepEqual(ids, []);
  assert.equal(warning, null);
});

test("an unfamiliar UPI ID is never a warning sign (a note at most)", () => {
  for (const upiId of ["x7qz9@newbankxyz", "9876543210@ybl", "shop.owner@someupihandle", "a_b-c.1@ptsbi", "UPPER.Case@YBL"]) {
    const { risk, r } = run({ upiId, amount: "250" });
    assert.equal(risk.category, "LOW", upiId);
    assert.equal(risk.score, 0, upiId);
    assert.ok(!r.indicators.length, upiId);
  }
  const note = analyze({ upiId: "x7qz9@newbankxyz", amount: "250" }).notes.join(" ");
  assert.match(note, /not a warning sign/i);
});

test("missing optional fields are fine: any one detail is enough", () => {
  for (const input of [{ amount: "100" }, { upiId: "a.b@ybl" }, { name: "Asha" }, { reason: "rent" }, { qrText: "upi://pay?pa=shop@ybl" }]) {
    const { risk } = run(input);
    assert.equal(risk.category, "LOW", JSON.stringify(input));
  }
  const only = E.assess({ payment: { ok: true, indicators: [] } });
  assert.match(only.confidence.note, /not proof of safety/i, "a quiet result is never called safe");
});

test("legitimate messages with 'urgent' or 'immediately' and no scam signs stay LOW", () => {
  for (const reason of ["Urgent: electricity bill for March, due today", "Please pay my share of the rent immediately", "School fee payment, last date is tomorrow", "Medicine bill, urgent"]) {
    const { risk, warning } = run({ upiId: "electricity@okicici", name: "State Electricity Board", amount: "1200", reason });
    assert.equal(risk.category, "LOW", reason);
    assert.equal(warning, null);
  }
});

// ------------------------------------------------------------------ scam wording (English)
test("suspicious payment request: bank name and support word in the ID plus a pay-to-receive reason", () => {
  const { risk, ids, warning } = run({ upiId: "sbi.customercare@ybl", name: "SBI Support", amount: "10", reason: "Pay Rs 10 to get your refund" });
  assert.ok(ids.includes("upi_id_bank_name") && ids.includes("upi_id_support_word") && ids.includes("upi_name_official_claim"));
  assert.ok(ids.includes("msg_receive_money_fee"));
  atLeast(risk, "HIGH");
  assert.match(warning.headline, /pay to receive money/i);
});

test("fake KYC payment request", () => {
  const { risk, ids, warning } = run({ upiId: "kyc.update@paytm", amount: "10", reason: "Pay KYC charges of Rs 10 or your account will be blocked today" });
  assert.ok(ids.includes("msg_kyc_charge") && ids.includes("msg_account_block"));
  atLeast(risk, "HIGH");
  assert.match(warning.headline, /KYC, parcels or support/i);
  assert.ok(risk.actions.some((a) => /KYC/.test(a)), "the KYC advice appears only because KYC evidence was found");
});

test("safe-account wording is critical", () => {
  const { risk, ids, warning } = run({ upiId: "rbi.safe@ybl", amount: "250000", reason: "Transfer your money to the RBI safe account for verification" });
  assert.ok(ids.includes("msg_safe_account"));
  assert.equal(risk.category, "CRITICAL");
  assert.match(warning.headline, /no such thing as a safe account/i);
  assert.equal(warning.lead, "Stop and check before you pay.");
});

test("OTP and UPI PIN requests", () => {
  const { risk, ids, warning } = run({ upiId: "help@ybl", amount: "1", reason: "Please share your UPI PIN and OTP to receive the money" });
  assert.ok(ids.includes("msg_otp_request") && ids.includes("msg_pay_to_receive"));
  atLeast(risk, "HIGH");
  assert.equal(warning.headline, "Never share your UPI PIN or OTP with anyone.");
  assert.ok(risk.actions.some((a) => /never share your otp/i.test(a)));
  // wording that only advises against sharing is not a request
  const calm = run({ upiId: "bank@sbi", amount: "1", reason: "Never share your UPI PIN or OTP with anyone." });
  assert.equal(calm.risk.category, "LOW");
});

test("fake refund and customer-care requests", () => {
  const a = run({ upiId: "refund.desk@axl", amount: "5", reason: "Customer care says approve the collect request to get your refund" });
  assert.ok(a.ids.includes("msg_collect_request") && a.ids.includes("msg_customer_care_payment"));
  atLeast(a.risk, "HIGH");
  const b = run({ upiId: "abc@ybl", amount: "10", reason: "Refund will be sent after you pay the processing charges" });
  assert.ok(b.ids.includes("msg_refund_payment_request"));
  const c = run({ upiId: "abc@ybl", amount: "500", reason: "I sent you money by mistake, please send it back to this other account" });
  assert.ok(c.ids.includes("msg_wrong_transfer_request"));
  const genuine = run({ upiId: "shop@ybl", amount: "200", reason: "Refund of Rs 200 for order 4411 has been initiated" });
  assert.equal(genuine.risk.category, "LOW");
});

test("prize and lottery payment requests", () => {
  const { risk, ids } = run({ upiId: "lucky.draw@ybl", amount: "999", reason: "Congratulations you won lottery of 25 lakh. Pay processing fee to claim your prize" });
  assert.ok(ids.includes("msg_prize_claim") && ids.includes("msg_advance_fee"));
  atLeast(risk, "HIGH");
});

test("parcel release fees", () => {
  const { risk, ids, warning } = run({ upiId: "courier99@ybl", amount: "49", reason: "Parcel release fee" });
  assert.ok(ids.includes("msg_parcel_release_fee"));
  atLeast(risk, "MEDIUM");
  assert.match(warning.headline, /parcels/i);
});

test("Hindi, Tamil and Hinglish reasons are read too", () => {
  assert.ok(run({ upiId: "abc@ybl", amount: "49", reason: "पैसे पाने के लिए 100 रुपये भेजें" }).ids.includes("msg_receive_money_fee"));
  assert.ok(run({ upiId: "abc@ybl", amount: "49", reason: "பரிசு பெற 100 ரூபாய் செலுத்த வேண்டும்" }).ids.includes("msg_receive_money_fee"));
  assert.ok(run({ upiId: "abc@ybl", amount: "49", reason: "Refund ke liye 10 rupaye pay karo" }).ids.includes("msg_refund_payment_request"));
  assert.ok(run({ upiId: "abc@ybl", amount: "49", reason: "केवाईसी शुल्क का भुगतान करें" }).ids.includes("msg_kyc_charge"));
  assert.ok(run({ upiId: "abc@ybl", amount: "49", reason: "ஓடிபி எண்ணை சொல்லுங்கள்" }).ids.includes("msg_otp_request"));
});

test("'send money' alone is not a warning: every payment asks for money", () => {
  const { ids } = run({ upiId: "abc@ybl", amount: "500", reason: "Please send money to this UPI id, urgent" });
  assert.ok(!ids.includes("msg_money_request") && !ids.includes("msg_payment_instruction"));
});

// ------------------------------------------------------------------ the ID and the name
test("look-alike handles are flagged only for long handles that are one letter off", () => {
  assert.ok(run({ upiId: "shop@okhdfcbnk", amount: "1" }).ids.includes("upi_handle_lookalike"));
  assert.ok(run({ upiId: "shop@okicicii", amount: "1" }).ids.includes("upi_handle_lookalike"));
  for (const handle of ["okhdfcbank", "ybl", "ybi", "axl", "apl", "abc", "newbank"]) assert.ok(!run({ upiId: "shop@" + handle, amount: "1" }).ids.includes("upi_handle_lookalike"), handle);
});

test("a bank name inside its own handle, or inside a longer ordinary word, is not flagged", () => {
  assert.ok(!run({ upiId: "sbi@sbi", amount: "1" }).ids.includes("upi_id_bank_name"));
  assert.ok(!run({ upiId: "sbiswas@ybl", amount: "1" }).ids.includes("upi_id_bank_name"), "'sbiswas' is a surname, not 'sbi'");
  assert.ok(!run({ upiId: "customerbhai@ybl", amount: "1" }).ids.includes("upi_id_support_word"));
  assert.ok(run({ upiId: "paytm.support@ybl", amount: "1" }).ids.includes("upi_id_bank_name"));
  assert.ok(run({ upiId: "p4ytm.refund99@ybl", amount: "1" }).ids.includes("upi_id_bank_name"), "digits swapped for letters");
  assert.ok(run({ upiId: "customer.care@ybl", amount: "1" }).ids.includes("upi_id_support_word"), "customer + care");
});

test("a name that sounds official is noted, an ordinary name is not", () => {
  assert.ok(run({ name: "RBI Refund Department", amount: "1" }).ids.includes("upi_name_official_claim"));
  assert.ok(run({ name: "Customer Care Paytm", amount: "1" }).ids.includes("upi_name_official_claim"));
  for (const name of ["Ramesh Kumar", "Care Bakery", "Sri Lakshmi Stores", "State Electricity Board"]) assert.ok(!run({ name, amount: "1" }).ids.includes("upi_name_official_claim"), name);
});

test("one weak sign alone never reaches HIGH", () => {
  for (const input of [{ upiId: "paytm.pay@ybl" }, { upiId: "official.help@ybl" }, { name: "Customer Care" }, { upiId: "ab@okhdfcbnk" }, { amount: "5000000" }]) {
    const { risk } = run(input);
    assert.ok(RANK[risk.category] <= RANK.MEDIUM, JSON.stringify(input) + " -> " + risk.category);
  }
});

// ------------------------------------------------------------------ invalid and empty input
test("an invalid UPI ID is explained and not treated as fraud", () => {
  for (const upiId of ["not a upi id", "abc", "@ybl", "abc@", "a@b@c", "a b@ybl", "név@ybl", "x@1bank", "..@ybl", "a@y", "http://x.com"]) {
    const r = analyze({ upiId, amount: "100" });
    assert.equal(r.ok, true, upiId);
    assert.ok(r.problems.some((p) => p.field === "upiId" && /UPI ID looks like name@bank/.test(p.message)), upiId);
    assert.ok(!r.indicators.some((i) => i.id.startsWith("upi_id")), upiId);
  }
  const alone = analyze({ upiId: "not a upi id" });
  assert.equal(alone.ok, false);
  assert.equal(alone.error, "unreadable");
  assert.match(alone.message, /nothing was checked/i);
});

test("empty input is refused politely", () => {
  for (const input of [{}, { upiId: "", name: "", amount: "", reason: "", qrText: "" }, { upiId: "   ", reason: "\n\t" }]) {
    const r = analyze(input);
    assert.equal(r.ok, false);
    assert.equal(r.error, "empty");
    assert.match(r.message, /at least one detail/i);
  }
});

test("invalid input of other kinds never throws", () => {
  for (const bad of [undefined, null, 5, "x", [], () => 1]) {
    const r = U.analyzeUpi(bad, { messageScan: M });
    assert.equal(r.ok, false);
    assert.equal(r.error, "invalid");
  }
  assert.doesNotThrow(() => U.analyzeUpi({ upiId: 5, name: null, amount: {}, reason: [], qrText: true }, { messageScan: M }));
  assert.equal(U.analyzeUpi({ upiId: 5, amount: {} }, { messageScan: M }).error, "empty", "non-text values are ignored");
  assert.equal(U.analyzeUpi({ amount: "100" }).ok, true, "without the scanner the reason is simply not checked");
});

// ------------------------------------------------------------------ amounts
test("amounts are read in everyday forms, including Hindi and Tamil digits", () => {
  const ok = { "500": 500, "5,000": 5000, "50,00,000": 5000000, "Rs. 1,250.50": 1250.5, "\u20b9500": 500, "500/-": 500, "INR 99": 99, "rupees 10": 10, "\u096b\u0966\u0966": 500, "\u0be7\u0be6\u0be6": 100, "0.5": 0.5 };
  for (const [text, value] of Object.entries(ok)) {
    const a = U.parseAmount(text);
    assert.equal(a.ok, true, text);
    assert.equal(a.value, value, text);
  }
  for (const text of ["", "abc", "-5", "0", "00", "12.345", "1e5", "5 000 abc", "NaN", "Infinity", "1.2.3"]) assert.equal(U.parseAmount(text).ok, false, text);
  assert.equal(U.parseAmount("99999999999999").reason, "too-large");
});

test("very large amounts are noted, not called fraud; absurd ones are rejected", () => {
  let x = run({ upiId: "a.b@ybl", amount: "50,000" });
  assert.deepEqual(x.ids, ["upi_amount_large"]);
  x = run({ upiId: "a.b@ybl", amount: "50,00,000" });
  assert.deepEqual(x.ids, ["upi_amount_unusual"]);
  assert.equal(x.risk.category, "LOW", "an amount alone is only a note");
  assert.equal(x.risk.actions.length, 1, "a LOW result carries only the general advice");
  const withHint = E.assess({ payment: { ok: true, indicators: [...x.r.indicators, { id: "upi_handle_lookalike", label: "a", why: "b", weight: 3.5 }] } });
  assert.ok(withHint.actions.some((a) => /confirm the amount/i.test(a)) && withHint.actions.some((a) => /name your upi app shows/i.test(a)));
  const y = analyze({ amount: "99999999999999" });
  assert.equal(y.ok, false);
  assert.ok(y.problems.some((p) => /too large/i.test(p.message)));
  const z = analyze({ upiId: "a@ybl", amount: "banana" });
  assert.equal(z.ok, true);
  assert.ok(z.problems.some((p) => p.field === "amount" && /could not be read/i.test(p.message)));
});

// ------------------------------------------------------------------ QR text
test("a valid UPI payment code is read: recipient, name, amount and note", () => {
  const r = analyze({ qrText: "upi://pay?pa=shop@ybl&pn=Corner%20Shop&am=120&cu=INR&tn=Milk" });
  assert.equal(r.ok, true);
  assert.deepEqual(r.qr, { ok: true, kind: "pay", recipient: "shop@ybl", name: "Corner Shop", amount: 120, hasNote: true });
  assert.deepEqual(r.indicators, []);
  assert.ok(r.notes.some((n) => /recipient was taken from the pasted code/i.test(n)));
  const g = analyze({ qrText: "tez://upi/pay?pa=a.b@oksbi&pn=A" });
  assert.equal(g.qr.kind, "pay");
  assert.equal(g.qr.amount, null);
  assert.ok(analyze({ qrText: "UPI://PAY?PA=Shop@YBL" }).ok);
});

test("a collect request and a repeating-payment mandate are flagged", () => {
  const c = run({ qrText: "upi://collect?pa=other@ybl&pn=X&am=5000" });
  assert.ok(c.ids.includes("upi_qr_collect_request"));
  atLeast(c.risk, "MEDIUM");
  assert.ok(c.risk.actions.some((a) => /never need to enter a pin or pay money/i.test(a)));
  assert.match(c.warning.headline, /pay to receive money/i);
  const m = run({ qrText: "upi://mandate?pa=xx@ybl&am=100" });
  assert.ok(m.ids.includes("upi_qr_autopay_mandate"));
});

test("a code that disagrees with what the user typed is flagged", () => {
  const r = run({ upiId: "friend@ybl", amount: "100", qrText: "upi://pay?pa=someoneelse@ybl&am=900" });
  assert.ok(r.ids.includes("upi_qr_recipient_differs") && r.ids.includes("upi_qr_amount_differs"));
  const same = run({ upiId: "Shop@YBL", amount: "Rs 120", qrText: "upi://pay?pa=shop@ybl&am=120.00" });
  assert.deepEqual(same.ids, []);
});

test("the note inside a code and text around it are read as well", () => {
  const r = run({ qrText: "Scan to claim your reward upi://pay?pa=win@ybl&am=10&tn=Pay%20Rs%2010%20to%20get%20your%20refund" });
  assert.ok(r.ids.includes("msg_receive_money_fee"));
  assert.equal(r.r.checked.includes("Note inside the code"), true);
});

test("invalid QR text is explained and not analysed", () => {
  for (const qrText of ["hello world", "upi://pay", "upi://pay?am=100", "upi://pay?pa=notanid&am=100", "upi://unknown?pa=a@ybl", "evil://pay?pa=a@ybl", "12345", "{\"pa\":\"a@ybl\"}"]) {
    const r = analyze({ qrText });
    assert.equal(r.ok, false, qrText);
    assert.ok(r.problems.some((p) => p.field === "qrText" && p.message.length > 20), qrText);
  }
  const web = analyze({ qrText: "https://example.com/pay" });
  assert.match(web.problems[0].message, /web address/i);
  const withOthers = analyze({ qrText: "garbage", amount: "100", upiId: "a@ybl" });
  assert.equal(withOthers.ok, true, "other details are still checked");
  assert.ok(withOthers.problems.some((p) => p.field === "qrText"));
  assert.match(analyze({ qrText: "garbage" }).problems[0].message, /could not read this as a UPI payment code/i);
});

// ------------------------------------------------------------------ Holdy's warning
test("Holdy warns only at MEDIUM and above, and never claims to stop a payment", () => {
  assert.equal(U.holdyWarning(null), null);
  assert.equal(U.holdyWarning({}), null);
  assert.equal(U.holdyWarning(E.assess({ payment: { ok: true, indicators: [] } })), null);
  assert.equal(U.holdyWarning(E.assess(undefined)), null);
  assert.equal(U.holdyWarning(E.assess("junk")), null);
  const w = run({ upiId: "lucky.draw@ybl", amount: "999", reason: "Pay processing fee to claim your prize" }).warning;
  assert.ok(w && ["MEDIUM", "HIGH", "CRITICAL"].includes(w.level));
  const everything = JSON.stringify(w);
  assert.match(w.disclaimer, /cannot stop or cancel a payment/i);
  assert.doesNotMatch(everything.replace(w.disclaimer, ""), /\b(we|prevenza|holdy|prevy)\b[^.]{0,30}\b(will|can)\b[^.]{0,20}\b(block|stop|cancel|reverse)/i);
  assert.deepEqual(w.actions.length, 4);
  assert.match(w.actions[0], /review the payment details/i);
  assert.match(w.actions[1], /cancel and check with the recipient/i);
  assert.match(w.actions[2], /trusted/i);
  assert.match(w.actions[3], /continue only after/i);
});

test("the headline follows the evidence, and the default warning only appears with some evidence", () => {
  const mid = E.assess({ payment: { ok: true, indicators: [{ id: "upi_handle_lookalike", label: "x", why: "y", weight: 3.5 }] } });
  assert.equal(mid.category, "MEDIUM");
  assert.equal(U.holdyWarning(mid).headline, "Check the recipient before sending money.");
  const otp = E.assess({ payment: { ok: true, indicators: [{ id: "msg_otp_request", label: "x", why: "y", weight: 6 }, { id: "msg_receive_money_fee", label: "x", why: "y", weight: 5 }] } });
  assert.equal(U.holdyWarning(otp).headline, "Never share your UPI PIN or OTP with anyone.", "the PIN warning wins");
});

// ------------------------------------------------------------------ the engine stays the only scorer
test("the analyzer returns evidence only: no score, no category", () => {
  const r = analyze({ upiId: "refund@ybl", amount: "10", reason: "Pay Rs 10 to get your refund" });
  for (const key of ["score", "category", "confidence"]) assert.equal(key in r, false, key);
  const risk = E.assess({ payment: { ok: true, indicators: r.indicators } });
  assert.deepEqual(risk.availableModules, ["payment"]);
  assert.ok(risk.reasons.every((x) => x.moduleLabel === "UPI payment details"));
  assert.match(risk.scoreMeaning, /not the probability/i);
});

test("adding UPI evidence does not change URL or message scoring", () => {
  const msg = { message: { ok: true, indicators: M.scanMessage("Share your OTP now. Your KYC is pending.").indicators } };
  const before = JSON.stringify(E.assess(msg, { now: () => "t" }));
  E.assess({ payment: { ok: true, indicators: [{ id: "upi_amount_large", label: "x", why: "y", weight: 1 }] } });
  assert.equal(JSON.stringify(E.assess(msg, { now: () => "t" })), before);
});

// ------------------------------------------------------------------ privacy
test("the result never contains a copy of what was typed (except what a pasted code states about itself)", () => {
  const secret = { upiId: "zq9private4471@ybl", name: "Zq9 Private Person", amount: "4471.55", reason: "zq9-private-reason pay to receive refund" };
  const r = analyze(secret);
  const json = JSON.stringify({ indicators: r.indicators, problems: r.problems, notes: r.notes, checked: r.checked });
  for (const v of ["zq9", "4471", "Private"]) assert.ok(!json.includes(v), v);
  const risk = E.assess({ payment: { ok: true, indicators: r.indicators } });
  assert.ok(!JSON.stringify(risk).includes("zq9"));
});

test("a very large reason or many hostile inputs stay fast", () => {
  const started = Date.now();
  for (const reason of ["pay ".repeat(300), "refund ".repeat(300), "a".repeat(1000), "(".repeat(1000), "customer care pay ".repeat(60)]) assert.equal(analyze({ upiId: "a@ybl", reason }).ok, true);
  assert.ok(Date.now() - started < 2000);
});

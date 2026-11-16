// Step 7: Prevy's intervention logic (holdy.js) and its text (holdy-text.js). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const Y = require("../src/shared/holdy.js");
const T = require("../src/shared/holdy-text.js");
const E = require("../src/shared/risk-engine.js");
const M = require("../src/shared/message-scan.js");
const U = require("../src/shared/upi-analyze.js");
const urlIntel = require("../src/shared/url-intel.js");

const ind = (id, weight, extra) => Object.assign({ id, label: "Label " + id, why: "Why " + id, weight }, extra || {});
const assess = (module, ...indicators) => E.assess({ [module]: { ok: true, indicators } });
const fromMessage = (text) => E.assess({ message: { ok: true, indicators: M.scanMessage(text).indicators } });
const fromUrl = (url) => E.assess({ url: { ok: true, indicators: urlIntel.analyzeUrl(url).indicators } });

// ------------------------------------------------------------------ text
test("every English key exists in Hindi and Tamil, with the same placeholders", () => {
  for (const lang of ["hi", "ta"]) {
    for (const [key, value] of Object.entries(T.en)) {
      assert.equal(typeof T[lang][key], "string", lang + " is missing " + key);
      assert.ok(T[lang][key].length > 0, lang + " " + key + " is empty");
      assert.deepEqual(T[lang][key].match(/\{\w+\}/g) || [], value.match(/\{\w+\}/g) || [], lang + " " + key + " placeholders");
    }
    assert.deepEqual(Object.keys(T[lang]).sort(), Object.keys(T.en).sort(), lang + " has extra keys");
  }
});

test("Hindi text is in Devanagari and Tamil text is in Tamil script", () => {
  const dev = /[\u0900-\u097f]/;
  const tam = /[\u0b80-\u0bff]/;
  for (const key of Object.keys(T.en)) {
    assert.match(T.hi[key], dev, "hi " + key);
    assert.match(T.ta[key], tam, "ta " + key);
  }
});

test("the text file says the translations need native-speaker review (no claim of full translation)", () => {
  const src = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "shared", "holdy-text.js"), "utf8");
  assert.match(src, /NEEDS NATIVE-SPEAKER REVIEW/);
  assert.match(T.en.note_partial, /Some details are only in English/);
});

test("no wording is frightening, shaming, or claims Prevy can block, cancel or reverse anything", () => {
  for (const [key, s] of Object.entries(T.en)) {
    assert.doesNotMatch(s, /\b(idiot|stupid|you will lose everything|act now|hurry|panic|guaranteed)\b/i, key);
    if (key.startsWith("d_")) assert.match(s, /cannot/, key);
    else assert.doesNotMatch(s, /\b(prevenza|prevy|holdy)\b[^.]{0,30}\b(will|has|can)\s+(block|cancel|stop|reverse)/i, key);
  }
});

// ------------------------------------------------------------------ tiers follow the engine's category
test("LOW gives a small informational note, never a warning card, and never says 'safe'", () => {
  const m = Y.build(fromMessage("Hi, are we meeting for lunch tomorrow?"), { context: "message" });
  assert.equal(m.tier, "info");
  assert.equal(m.show, "note");
  assert.match(m.note, /not a guarantee/);
  assert.doesNotMatch(m.note, /\bsafe\b/i);
});

test("MEDIUM, HIGH and CRITICAL give a card of rising strength", () => {
  const medium = Y.build(assess("message", ind("msg_kyc_update", 3)), { context: "message" });
  assert.equal(medium.tier, "caution");
  assert.equal(medium.show, "card");
  assert.equal(medium.urgent, false);
  assert.equal(medium.lead, "Hold on!");
  const high = Y.build(assess("message", ind("msg_kyc_update", 3), ind("msg_account_block", 3)), { context: "message" });
  assert.equal(high.tier, "warning");
  assert.equal(high.urgent, true);
  const critical = Y.build(assess("message", ind("msg_digital_arrest", 8, { critical: true })), { context: "message" });
  assert.equal(critical.tier, "stop");
  assert.equal(critical.lead, "Stop and check first.");
  assert.equal(critical.urgent, true);
});

test("INCONCLUSIVE explains the uncertainty and is never treated as safe", () => {
  const m = Y.build(E.assess({ screenshot: { unavailable: true, reason: "No readable text." } }), { context: "screenshot" });
  assert.equal(m.tier, "uncertain");
  assert.equal(m.show, "note");
  assert.match(m.note, /could not confidently check this/);
  assert.match(m.note, /does not mean it is safe/);
});

test("a missing or unreadable result shows nothing, and is never treated as safe", () => {
  for (const a of [undefined, null, 5, "x", {}, { category: "WHATEVER" }, E.assess(undefined)]) {
    const m = Y.build(a, { context: "url" });
    assert.equal(m.tier, "none");
    assert.equal(m.show, false);
    assert.equal(m.note, undefined);
  }
});

// ------------------------------------------------------------------ headlines are chosen by evidence, per context
test("URL warning: a look-alike bank address gets the website headline and the look-alike explanation", () => {
  const m = Y.build(fromUrl("https://sbi-kyc-update.xyz/login"), { context: "url" });
  assert.equal(m.show, "card");
  assert.equal(m.headline, "This website address looks suspicious. Verify the official website before entering information.");
  assert.ok(m.simple.includes("This website address looks similar to a trusted website. It may be fake."));
  assert.match(m.disclaimer, /cannot block a website/);
  assert.ok(m.actions.some((a) => /Close the page yourself/.test(a)));
});

test("a shortened link gets the 'hidden destination' explanation, not the look-alike one", () => {
  const m = Y.build(assess("url", ind("shortener", 3), ind("redirect_param", 1)), { context: "url" });
  assert.ok(m.simple.includes(T.en.s_hidden_link));
  assert.ok(!m.simple.includes(T.en.s_lookalike));
});

test("message warning: urgency plus an OTP request gets the exact urgency headline", () => {
  const m = Y.build(fromMessage("Share your OTP immediately or your account will be blocked."), { context: "message" });
  assert.equal(m.headline, "This message is creating urgency and asking for sensitive information. Do not share your OTP or PIN.");
  assert.ok(m.simple.includes("Someone may be trying to steal your password or OTP."));
  const noRush = Y.build(fromMessage("Please share the OTP you received with me."), { context: "message" });
  assert.equal(noRush.headline, T.en.h_otp, "without urgency evidence the urgency headline is not used");
});

test("message warning without any special sign uses the general message headline", () => {
  const m = Y.build(assess("message", ind("msg_prize_claim", 3), ind("msg_click_link", 1.5)), { context: "message" });
  assert.equal(m.headline, T.en.h_default_message);
});

test("UPI warning: the generic headline asks to check the recipient; the UPI module keeps its Step 5 output", () => {
  const a = assess("payment", ind("upi_handle_lookalike", 3.5));
  const m = Y.build(a, { context: "upi" });
  assert.equal(m.headline, "Check the recipient before sending money.");
  assert.equal(m.actions.length, 4);
  assert.equal(m.actions[0], "Review the payment details above.");
  const w = U.holdyWarning(a);
  assert.equal(w.headline, m.headline);
  assert.deepEqual(w.actions, m.actions);
  assert.equal(w.disclaimer, U.CANNOT_STOP);
  const crit = Y.build(assess("payment", ind("msg_safe_account", 8, { critical: true })), { context: "upi" });
  assert.equal(crit.lead, "Stop and check before you pay.");
  assert.equal(crit.headline, T.en.h_safe);
});

test("screenshot warning: payment instructions, OTP requests and fake confirmations get their own headlines", () => {
  const pay = Y.build(assess("screenshot", ind("msg_payment_instruction", 3.5), ind("msg_money_request", 2.5)), { context: "screenshot" });
  assert.equal(pay.headline, "This screenshot contains suspicious payment instructions. Verify independently before taking action.");
  const otp = Y.build(assess("screenshot", ind("msg_otp_request", 6)), { context: "screenshot" });
  assert.equal(otp.headline, "Someone is asking for your OTP or UPI PIN. Never share these details.");
  const release = Y.build(assess("screenshot", ind("msg_release_goods_request", 3.5), ind("msg_payment_screenshot_claim", 1)), { context: "screenshot" });
  assert.equal(release.headline, "Do not release goods based only on a payment screenshot.");
  assert.ok(release.simple.includes(T.en.s_screenshot));
  assert.match(release.disclaimer, /cannot check whether a payment really happened/);
});

test("the payment-screenshot headline is never used outside screenshots", () => {
  const m = Y.build(assess("message", ind("msg_payment_instruction", 3.5), ind("msg_money_request", 2.5)), { context: "message" });
  assert.notEqual(m.headline, T.en.h_screenshot_pay);
});

test("a specific warning is shown only when its evidence exists", () => {
  const m = Y.build(assess("message", ind("msg_kyc_update", 3), ind("msg_account_block", 2)), { context: "message" });
  assert.ok(!m.simple.includes(T.en.s_secret), "no OTP line without OTP evidence");
  assert.ok(!m.simple.includes(T.en.s_lookalike), "no website line without URL evidence");
  assert.notEqual(m.headline, T.en.h_otp_message);
  const urlInMessage = E.assess({ message: { ok: true, indicators: [ind("msg_urgency", 1.2)] }, url: { ok: true, indicators: urlIntel.analyzeUrl("https://sbi-kyc-update.xyz").indicators } });
  assert.equal(Y.build(urlInMessage, { context: "message" }).headline, T.en.h_url, "a bad link inside a message gets the website headline");
});

// ------------------------------------------------------------------ evidence and actions
test("the evidence shown is the engine's own, strongest first, and limited", () => {
  const a = assess("message", ind("msg_click_link", 1.5), ind("msg_otp_request", 6), ind("msg_kyc_update", 3), ind("msg_urgency", 1.2));
  const m = Y.build(a, { context: "message" });
  assert.deepEqual(m.signs.map((s) => s.label), ["Label msg_otp_request", "Label msg_kyc_update", "Label msg_click_link"]);
  assert.ok(m.signs.every((s) => s.source === "Message text"));
  assert.ok(m.simple.length <= 3);
});

test("elder mode shows one simple explanation and one sign, but all the safety actions", () => {
  const a = assess("message", ind("msg_otp_request", 6), ind("msg_kyc_update", 3), ind("msg_urgency", 1.2));
  const m = Y.build(a, { context: "message", elder: true });
  assert.equal(m.simple.length, 1);
  assert.equal(m.signs.length, 1);
  assert.equal(m.actions.length, 5);
});

test("every non-UPI warning offers the five safety steps, none of which acts by itself", () => {
  for (const context of ["url", "message", "screenshot"]) {
    const m = Y.build(assess("message", ind("msg_otp_request", 6)), { context });
    assert.equal(m.actions.length, 5, context);
    assert.match(m.actions[0], /Review the warning signs/);
    assert.match(m.actions[2], /number or website you already know/);
    assert.match(m.actions[3], /trusted family member/);
    assert.match(m.actions[4], /Continue only after/);
    assert.ok(m.actions.every((x) => !/\b(we|prevenza|prevy) (will|have)\b/i.test(x)), context);
  }
});

// ------------------------------------------------------------------ languages
test("Hindi and Tamil choose the translated wording; unknown languages fall back to English", () => {
  const a = fromMessage("Share your OTP immediately or your account will be blocked.");
  const hi = Y.build(a, { context: "message", language: "hi" });
  assert.equal(hi.headline, T.hi.h_otp_message);
  assert.equal(hi.partial, true);
  assert.equal(hi.labels.partial, T.hi.note_partial);
  const ta = Y.build(a, { context: "message", language: "ta" });
  assert.equal(ta.lead, T.ta.lead_hold);
  const xx = Y.build(a, { context: "message", language: "fr" });
  assert.equal(xx.language, "en");
  assert.equal(xx.partial, false);
  assert.equal(Y.build(a, { context: "message", language: "hi" }).signs[0].label, Y.build(a, { context: "message" }).signs[0].label, "detailed reasons stay in English");
});

test("the 'hidden' note keeps the risk level visible in every language", () => {
  const a = assess("message", ind("msg_kyc_update", 3), ind("msg_account_block", 3));
  for (const language of ["en", "hi", "ta"]) assert.match(Y.build(a, { context: "message", language }).labels.hidden, /High risk/);
});

// ------------------------------------------------------------------ duplicate control fingerprint
test("the repeat fingerprint depends on the result, not on any checked content", () => {
  const one = Y.build(fromMessage("Please share your OTP now, Zq9-secret-111"), { context: "message" });
  const two = Y.build(fromMessage("Please share your OTP now, other words entirely 222"), { context: "message" });
  assert.equal(one.key, two.key, "same signs, same level: same fingerprint");
  assert.ok(!one.key.includes("Zq9") && !one.key.includes("111"));
  const other = Y.build(fromMessage("Your KYC is pending, update now or your account will be blocked"), { context: "message" });
  assert.notEqual(one.key, other.key);
  assert.notEqual(Y.build(fromMessage("Please share your OTP now"), { context: "screenshot" }).key, one.key, "the context is part of it");
  assert.ok(!JSON.stringify(one).includes("Zq9"), "the whole model holds no content");
});

test("building a warning does not change the assessment", () => {
  const a = fromMessage("Share your OTP immediately or your account will be blocked.");
  const copy = JSON.parse(JSON.stringify(a));
  Y.build(a, { context: "message", language: "ta", elder: true });
  assert.deepEqual(a, copy);
});

// Detection spot-check (Step 11). Runs the real offline analyzers and the central risk engine on a small labelled set
// of made-up examples and prints what happened, including every miss and every false alarm.
//
// Run: npm run audit:detection        (add --json for machine-readable output)
//
// IMPORTANT: this is a spot-check, not an accuracy measurement. Many of these examples are similar to the ones the rules
// were written from, so the numbers would look better than real life. The project rules say accuracy claims need a
// held-out set that the rules were never tuned on. This is not that set. All examples are invented test data.
"use strict";
const urlIntel = require("../src/shared/url-intel.js");
const messageScan = require("../src/shared/message-scan.js");
const upiAnalyze = require("../src/shared/upi-analyze.js");
const engine = require("../src/shared/risk-engine.js");

// expect: "warn" means a warning is wanted (MEDIUM or higher), "quiet" means LOW is wanted, "reject" means the input
// should be refused as invalid. "any" records the result without judging it (for genuinely ambiguous cases).
const URLS = [
  ["legit", "https://www.sbi.co.in/", "quiet"],
  ["legit", "https://www.google.com/search?q=weather", "quiet"],
  ["legit", "https://www.amazon.in/gp/cart", "quiet"],
  ["legit", "https://www.irctc.co.in/nget/train-search", "quiet"],
  ["legit", "https://www.india.gov.in/", "quiet"],
  ["legit", "https://paytm.com/", "quiet"],
  ["legit", "https://en.wikipedia.org/wiki/Phishing", "quiet"],
  ["lookalike", "http://sbi-kyc-update.xyz/login", "warn"],
  ["lookalike", "https://paytrn.com/", "warn"],
  ["lookalike", "https://amaz0n-offers.in/", "warn"],
  ["lookalike", "https://hdfcbank-secure-login.top/", "warn"],
  ["misleading subdomain", "https://sbi.co.in.verify-account.xyz/", "warn"],
  ["misleading subdomain", "https://www.paytm.com.refund-help.site/", "warn"],
  ["IP address", "http://103.21.58.4/sbi/login", "warn"],
  ["IP address", "http://0x7f000001/", "any"],
  ["shortener", "https://bit.ly/3abcXYZ", "warn"],
  ["shortener", "https://tinyurl.com/kyc-update", "warn"],
  ["formatting", "https://www.sbi.co.in@evil.example/", "warn"],
  ["formatting", "http://secure-login-verify-account-update-kyc-sbi-online.example.com/", "warn"],
  ["unicode/punycode", "https://xn--pple-43d.com/", "warn"],
  ["unicode/punycode", "https://\u0440aytm.com/", "warn"],
  ["unicode/punycode", "https://\u092a\u0947\u091f\u0940\u090f\u092e.com/", "any"],
  ["invalid", "ht!tp://:::", "reject"],
  ["invalid", "javascript:alert(1)", "reject"],
  ["invalid", "", "reject"],
];

const MESSAGES = [
  ["fake KYC (en)", "Dear customer, your SBI KYC has expired. Update now at http://sbi-kyc-update.xyz or your account will be blocked today.", "warn"],
  ["fake KYC (hi)", "\u092a\u094d\u0930\u093f\u092f \u0917\u094d\u0930\u093e\u0939\u0915, \u0906\u092a\u0915\u093e KYC \u0938\u092e\u093e\u092a\u094d\u0924 \u0939\u094b \u0917\u092f\u093e \u0939\u0948\u0964 \u0905\u092a\u0928\u093e \u0916\u093e\u0924\u093e \u092c\u0902\u0926 \u0939\u094b\u0928\u0947 \u0938\u0947 \u092c\u091a\u093e\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f \u0924\u0941\u0930\u0902\u0924 \u0905\u092a\u0921\u0947\u091f \u0915\u0930\u0947\u0902\u0964", "warn"],
  ["fake KYC (hinglish)", "Aapka KYC expire ho gaya hai. Turant update karein warna account block ho jayega. Link pe click karein.", "warn"],
  ["digital arrest (en)", "This is CBI officer. You are under digital arrest. Do not tell anyone. Transfer Rs 50000 to the safe account now.", "warn"],
  ["digital arrest (ta)", "\u0ba8\u0bbe\u0ba9\u0bcd \u0b9a\u0bbf\u0baa\u0bbf\u0b90 \u0b85\u0ba4\u0bbf\u0b95\u0bbe\u0bb0\u0bbf. \u0ba8\u0bc0\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b9f\u0bbf\u0b9c\u0bbf\u0b9f\u0bcd\u0b9f\u0bb2\u0bcd \u0b95\u0bc8\u0ba4\u0bc1 \u0b9a\u0bc6\u0baf\u0bcd\u0baf\u0baa\u0bcd\u0baa\u0b9f\u0bcd\u0b9f\u0bc1\u0bb3\u0bcd\u0bb3\u0bc0\u0bb0\u0bcd\u0b95\u0bb3\u0bcd. \u0b89\u0b9f\u0ba9\u0bc7 \u0baa\u0ba3\u0bae\u0bcd \u0b85\u0ba9\u0bc1\u0baa\u0bcd\u0baa\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd.", "warn"],
  ["parcel fee", "Your India Post parcel is held at the hub due to incomplete address. Pay Rs 25 redelivery fee at http://indiapost-redeliver.top within 24 hours.", "warn"],
  ["OTP request", "Hello sir, I am calling from your bank. Please share the OTP you just received to stop the unauthorised transaction.", "warn"],
  ["OTP request (hinglish)", "Sir aapke account se galti se paise aa gaye hain, jo OTP aaya hai woh bata dijiye please.", "warn"],
  ["UPI PIN request", "To receive your Rs 5000 cashback, enter your UPI PIN on the request sent to your phone.", "warn"],
  ["fake customer care", "Paytm customer care: your wallet is suspended. Call 98XXXXXX10 and install AnyDesk so our agent can help you.", "warn"],
  ["lottery", "Congratulations! You won a lottery of 25 lakh. Pay the processing fee of Rs 999 to claim your prize.", "warn"],
  ["safe account", "Your account is under investigation. Move all your money to this RBI safe account immediately to protect it.", "warn"],
  ["job scam", "Earn Rs 3000 daily by liking YouTube videos. Pay Rs 500 registration fee to start today.", "warn"],
  ["legit bank alert", "Rs 1,250.00 debited from A/c XX1234 on 12-11-26 to VPA grocery@okaxis. Not you? Call the number on the back of your card.", "quiet"],
  ["legit OTP delivery", "123456 is your OTP for login. Do not share it with anyone. SBI never asks for your OTP.", "quiet"],
  ["legit delivery", "Your Amazon order #402-1234567 has been delivered. Thank you for shopping with us.", "quiet"],
  ["normal (en)", "Hi Amma, I will reach home by 7 pm. Keep dinner ready.", "quiet"],
  ["normal (hi)", "\u0915\u0932 \u0936\u093e\u092e \u0915\u094b \u092e\u0902\u0926\u093f\u0930 \u091a\u0932\u0947\u0902\u0917\u0947\u0964 \u0938\u092e\u092f \u092a\u0930 \u0924\u0948\u092f\u093e\u0930 \u0930\u0939\u0928\u093e\u0964", "quiet"],
  ["normal (ta)", "\u0ba8\u0bbe\u0bb3\u0bc8 \u0b95\u0bbe\u0bb2\u0bc8 \u0baa\u0ba4\u0bcd\u0ba4\u0bc1 \u0bae\u0ba3\u0bbf\u0b95\u0bcd\u0b95\u0bc1 \u0b95\u0bcb\u0bb5\u0bbf\u0bb2\u0bc1\u0b95\u0bcd\u0b95\u0bc1\u0baa\u0bcd \u0baa\u0bcb\u0b95\u0bb2\u0bbe\u0bae\u0bcd.", "quiet"],
  ["normal (hinglish)", "Kal movie chalein? Main 6 baje tak free ho jaunga.", "quiet"],
  ["normal (urgent but fine)", "Please send the project report urgently, the meeting starts in 10 minutes.", "quiet"],
];

const UPI = [
  ["normal", { upiId: "ramesh.kumar@okicici", name: "Ramesh Kumar", amount: "450", reason: "Vegetables" }, "quiet"],
  ["normal, optional fields missing", { upiId: "shop123@ybl", amount: "120" }, "quiet"],
  ["normal QR", { qrText: "upi://pay?pa=teashop@paytm&pn=Tea%20Shop&am=20" }, "quiet"],
  ["fake refund", { upiId: "refund.helpdesk@ybl", name: "Customer Care Refund", amount: "4999", reason: "Pay this amount to receive your refund." }, "warn"],
  ["pay to receive", { upiId: "prize.claim@axl", amount: "999", reason: "Pay Rs 999 to receive your Rs 25 lakh lottery prize money" }, "warn"],
  ["fake KYC payment", { upiId: "kyc.update@ybl", amount: "10", reason: "KYC update charge, else account blocked today" }, "warn"],
  ["PIN to receive", { upiId: "cashback.offer@ibl", amount: "5000", reason: "Enter UPI PIN to receive cashback" }, "warn"],
  ["unfamiliar ID, ordinary payment", { upiId: "x9k2p7@okhdfcbank", amount: "300" }, "quiet"],
  ["invalid UPI ID", { upiId: "not a upi id", amount: "100" }, "any"],
  ["invalid amount", { upiId: "ramesh@okicici", amount: "-5abc" }, "any"],
  ["nothing given", {}, "reject"],
];

const isWarn = (c) => c === "MEDIUM" || c === "HIGH" || c === "CRITICAL";

function judge(expect, outcome) {
  if (expect === "any") return "recorded";
  if (expect === "reject") return outcome.rejected ? "ok" : "MISS (accepted)";
  if (outcome.rejected) return "MISS (rejected)";
  if (expect === "warn") return isWarn(outcome.category) ? "ok" : "FALSE NEGATIVE";
  return isWarn(outcome.category) ? "FALSE POSITIVE" : outcome.category === "LOW" ? "ok" : "NOT LOW (" + outcome.category + ")";
}

function runUrl([group, input, expect]) {
  const r = urlIntel.analyzeUrl(input);
  if (!r.ok) return { kind: "url", group, input, expect, outcome: { rejected: true, message: r.message } };
  const a = engine.assess({ url: { ok: true, indicators: r.indicators } });
  return { kind: "url", group, input, expect, outcome: { category: a.category, score: a.score, urlLevel: r.level, signs: r.indicators.map((i) => i.id) } };
}

function runMessage([group, text, expect]) {
  const s = messageScan.scanMessage(text, { language: "auto" });
  if (!s.ok) return { kind: "message", group, input: text, expect, outcome: { rejected: true, message: s.message } };
  const links = [];
  for (const l of messageScan.extractLinks(text)) {
    const r = urlIntel.analyzeUrl(l);
    if (r.ok) links.push(...r.indicators);
  }
  const a = engine.assess({ message: { ok: true, indicators: s.indicators }, url: links.length ? { ok: true, indicators: links } : undefined });
  return { kind: "message", group, input: text, expect, outcome: { category: a.category, score: a.score, language: s.language.id, signs: s.indicators.filter((i) => i.weight > 0).map((i) => i.id) } };
}

function runUpi([group, fields, expect]) {
  const u = upiAnalyze.analyzeUpi(fields, { messageScan });
  if (!u.ok) return { kind: "upi", group, input: JSON.stringify(fields), expect, outcome: { rejected: true, message: u.message } };
  const a = engine.assess({ payment: { ok: true, indicators: u.indicators } });
  return { kind: "upi", group, input: JSON.stringify(fields), expect, outcome: { category: a.category, score: a.score, signs: u.indicators.filter((i) => i.weight > 0).map((i) => i.id), problems: u.problems.map((p) => p.field) } };
}

function run() {
  const rows = [...URLS.map(runUrl), ...MESSAGES.map(runMessage), ...UPI.map(runUpi)];
  for (const r of rows) r.verdict = judge(r.expect, r.outcome);
  const summary = {};
  for (const r of rows) {
    const s = (summary[r.kind] = summary[r.kind] || { total: 0, ok: 0, falsePositives: 0, falseNegatives: 0, other: 0, recorded: 0 });
    s.total += 1;
    if (r.verdict === "ok") s.ok += 1;
    else if (r.verdict === "recorded") s.recorded += 1;
    else if (r.verdict === "FALSE POSITIVE") s.falsePositives += 1;
    else if (r.verdict === "FALSE NEGATIVE") s.falseNegatives += 1;
    else s.other += 1;
  }
  return { rows, summary };
}

module.exports = { run, URLS, MESSAGES, UPI };

if (require.main === module) {
  const { rows, summary } = run();
  if (process.argv.includes("--json")) {
    console.log(JSON.stringify({ rows, summary }, null, 2));
  } else {
    for (const r of rows) {
      const o = r.outcome;
      const what = o.rejected ? "refused: " + o.message : o.category + (o.score === null ? "" : " " + o.score);
      const input = r.input.length > 70 ? r.input.slice(0, 67) + "..." : r.input;
      console.log(`${r.verdict.padEnd(16)} ${r.kind.padEnd(8)} ${r.group.padEnd(28)} expect ${r.expect.padEnd(6)} -> ${what.padEnd(22)} ${input}`);
    }
    console.log("\nSummary (spot-check on invented examples, NOT an accuracy measurement):");
    for (const [k, s] of Object.entries(summary)) console.log(`  ${k}: ${s.ok}/${s.total - s.recorded} as expected, ${s.falsePositives} false positives, ${s.falseNegatives} false negatives, ${s.other} other, ${s.recorded} recorded without a verdict`);
  }
}

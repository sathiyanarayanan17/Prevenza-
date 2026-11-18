// Step 12: the held-out evaluation tool. Its numbers are the only accuracy figures the project may report. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const Ev = require("../scripts/evaluate-holdout.js");

function folder(lines, name) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "prevenza-holdout-"));
  fs.writeFileSync(path.join(dir, name || "set.jsonl"), lines.map((l) => (typeof l === "string" ? l : JSON.stringify(l))).join("\n"));
  return dir;
}
const scamMsg = { kind: "message", label: "scam", text: "Dear customer, your SBI KYC is pending. Your account will be blocked today. Share the OTP now." };
const legitMsg = { kind: "message", label: "legit", text: "Hi Amma, I will reach home by 7 pm." };

test("the real held-out folder exists, explains the rules, and ships with no examples (so no accuracy can be claimed)", () => {
  const dir = path.join(__dirname, "..", "data", "holdout");
  const readme = fs.readFileSync(path.join(dir, "README.md"), "utf8");
  for (const re of [/Collect first, look later/, /Never tune on this set/, /Include both sides/, /Remove private details/, /no accuracy figure/]) assert.match(readme, re);
  const { examples } = Ev.load(dir);
  const out = Ev.report(Ev.evaluate(examples), []);
  assert.match(out, /No accuracy figure can be claimed/);
  assert.doesNotMatch(out, /Detection rate/);
});

test("fewer than 50 examples: counts only, never rates", () => {
  const dir = folder([scamMsg, legitMsg, scamMsg]);
  const r = Ev.evaluate(Ev.load(dir).examples);
  assert.equal(r.total, 3);
  assert.equal(r.enough, false);
  const out = Ev.report(r, []);
  assert.match(out, /warned on 2 scams/);
  assert.match(out, /No accuracy figure/);
  assert.doesNotMatch(out, /%/);
});

test("with enough examples, rates come with 95% intervals; wrong results name lines, never their content", () => {
  const lines = [];
  for (let i = 0; i < 30; i++) lines.push(scamMsg);
  for (let i = 0; i < 25; i++) lines.push(legitMsg);
  lines.push({ kind: "message", label: "scam", text: "SECRET-MARKER see you at lunch tomorrow" }); // a scam the rules miss
  lines.push({ kind: "url", label: "legit", url: "https://www.sbi.co.in/" });
  lines.push({ kind: "url", label: "scam", url: "https://sbi.co.in.verify-account.xyz/login" });
  lines.push({ kind: "upi", label: "scam", payment: { upiId: "refund.helpdesk@ybl", reason: "Pay to receive your refund" } });
  lines.push({ kind: "message", label: "scam", text: "తెలుగు కాదు ગુજરાતી સંદેશ છે, હમણાં જ મોકલો" }); // mostly Gujarati: inconclusive
  const r = Ev.evaluate(Ev.load(folder(lines)).examples);
  assert.equal(r.enough, true);
  assert.equal(r.counts.fn, 1);
  assert.equal(r.counts.inconclusiveScam, 1);
  assert.equal(r.counts.fp, 0);
  const out = Ev.report(r, []);
  assert.match(out, /Detection rate \(scams warned on\): \d+\.\d% +\(95% interval \d+\.\d% to \d+\.\d%\)/);
  assert.match(out, /False-alarm rate/);
  assert.match(out, /set\.jsonl:56 missed scam/);
  assert.doesNotMatch(out, /SECRET-MARKER/);
});

test("bad lines are skipped and reported, never crash the run", () => {
  const dir = folder(["{not json", JSON.stringify({ kind: "sms", label: "scam", text: "x" }), JSON.stringify({ kind: "message", label: "maybe", text: "x" }), JSON.stringify(legitMsg), ""]);
  const { examples, problems } = Ev.load(dir);
  assert.equal(examples.length, 1);
  assert.equal(problems.length, 3);
  assert.deepEqual(Ev.load(path.join(dir, "missing")).examples, []);
});

test("the Wilson interval is honest for small and extreme samples", () => {
  assert.equal(Ev.wilson(0, 0), null);
  const [lo, hi] = Ev.wilson(10, 10);
  assert.ok(lo > 0.65 && lo < 0.75 && hi === 1, "10 of 10 is not proof of 100%: " + lo);
  const [a, b] = Ev.wilson(50, 100);
  assert.ok(a > 0.39 && b < 0.61);
});

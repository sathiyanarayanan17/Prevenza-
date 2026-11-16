// The central risk engine (risk-engine.js, risk-rules.js). Step 4 sends all message evidence through it, so its rules are
// tested here: missing data is never "safe", duplicates count once, one weak sign is never proof, boundaries are exact.
const test = require("node:test");
const assert = require("node:assert/strict");
const E = require("../src/shared/risk-engine.js");
const R = require("../src/shared/risk-rules.js");

const NOW = () => "2026-01-01T00:00:00.000Z";
const assess = (input) => E.assess(input, { now: NOW });
const ind = (id, weight, extra) => Object.assign({ id, label: "Label " + id, why: "Why " + id, weight }, extra || {});
const mod = (...indicators) => ({ ok: true, indicators });
const only = (...w) => assess({ message: mod(...w.map((x, i) => ind("i" + i, x))) });

test("no input at all is 'not scanned', never 'safe'", () => {
  for (const input of [undefined, null, {}]) {
    const a = assess(input);
    assert.equal(a.status, "not_scanned");
    assert.equal(a.category, "NOT_SCANNED");
    assert.equal(a.score, null);
    assert.deepEqual(a.availableModules, []);
  }
});

test("input that cannot be read is 'inconclusive', never 'safe'", () => {
  for (const input of ["text", 5, [], true]) {
    const a = assess(input);
    assert.equal(a.category, "INCONCLUSIVE");
    assert.equal(a.score, null);
  }
  const bad = assess({ message: "oops", url: 5 });
  assert.equal(bad.category, "INCONCLUSIVE");
  assert.ok(bad.unavailableModules.some((m) => m.id === "message"));
});

test("a module that failed or is marked unavailable is listed as unavailable, with a reason", () => {
  const a = assess({ message: mod(ind("a", 3)), url: { ok: false }, payment: { unavailable: true, reason: "Not built yet." } });
  assert.deepEqual(a.availableModules, ["message"]);
  assert.ok(a.unavailableModules.find((m) => m.id === "url").reason.length > 0);
  assert.equal(a.unavailableModules.find((m) => m.id === "payment").reason, "Not built yet.");
});

test("a module that is not built yet is never trusted, even if someone passes data for it", () => {
  const a = assess({ message: mod(ind("a", 1)), community: mod(ind("fake", -50)) });
  assert.ok(!a.availableModules.includes("community"));
  assert.ok(a.unavailableModules.some((m) => m.id === "community"));
});

test("a missing module does not add or remove risk", () => {
  const withOne = assess({ message: mod(ind("a", 4), ind("b", 4)) });
  const withEmpties = assess({ message: mod(ind("a", 4), ind("b", 4)), url: undefined, payment: null, screenshot: {} });
  assert.equal(withOne.score, withEmpties.score);
});

test("zero signs from a checked module is LOW and says it is not proof of safety", () => {
  const a = assess({ message: mod() });
  assert.equal(a.score, 0);
  assert.equal(a.category, "LOW");
  assert.match(a.confidence.note, /not proof of safety/i);
  assert.equal(a.confidence.level, "LOW");
});

test("category boundaries are exact", () => {
  assert.equal(E.categoryOf(0), "LOW");
  assert.equal(E.categoryOf(24), "LOW");
  assert.equal(E.categoryOf(25), "MEDIUM");
  assert.equal(E.categoryOf(49), "MEDIUM");
  assert.equal(E.categoryOf(50), "HIGH");
  assert.equal(E.categoryOf(74), "HIGH");
  assert.equal(E.categoryOf(75), "CRITICAL");
  assert.equal(E.categoryOf(100), "CRITICAL");
});

test("points turn into the right score at each boundary", () => {
  assert.equal(only(1.5, 1.4).score, 24); // 2.9 points
  assert.equal(only(1.5, 1.5).category, "MEDIUM"); // 3 points = 25
  assert.equal(only(3, 2.9).score, 49);
  assert.equal(only(3, 3).score, 50);
  assert.equal(only(3, 3).category, "HIGH");
  assert.equal(only(4, 4, 3.9).category, "HIGH"); // 11.9 points
  assert.equal(only(4, 4, 4).category, "CRITICAL"); // 12 points = 75
  assert.equal(only(4, 4, 4).score, 75);
  const huge = assess({ message: mod(ind("a", 12), ind("b", 12), ind("c", 12), ind("d", 12)), url: mod(ind("e", 12), ind("f", 12)) });
  assert.ok(huge.score <= 100 && huge.score >= 90);
});

test("scores always stay between 0 and 100 and are whole numbers", () => {
  for (const w of [[], [0.1], [1], [12], [12, 12, 12, 12, 12, 12], [-5], [-5, 1], [1e9], [NaN], [Infinity]]) {
    const a = assess({ message: mod(...w.map((x, i) => ind("x" + i, x))) });
    if (typeof a.score === "number") assert.ok(Number.isInteger(a.score) && a.score >= 0 && a.score <= 100, JSON.stringify(w) + " -> " + a.score);
  }
});

test("one weak sign is never proof: a single ordinary indicator cannot reach HIGH", () => {
  const a = only(12);
  assert.ok(a.score <= R.LIMITS.singleIndicatorMaxScore, "got " + a.score);
  assert.notEqual(a.category, "HIGH");
  assert.notEqual(a.category, "CRITICAL");
  assert.equal(only(0.5).category, "LOW");
});

test("a critical indicator always means at least the critical floor", () => {
  const a = assess({ message: mod(ind("c", 4, { critical: true })) });
  assert.ok(a.score >= R.LIMITS.criticalFloor);
  assert.equal(a.category, "CRITICAL");
  assert.equal(a.confidence.level, "HIGH");
  assert.equal(assess({ message: mod(ind("c", -4, { critical: true })) }).score, 0, "a negative indicator cannot be critical");
});

test("the same indicator reported twice counts once, inside a module and across modules", () => {
  const once = assess({ message: mod(ind("dup", 4)) });
  const twice = assess({ message: mod(ind("dup", 4), ind("dup", 4), ind("dup", 4)) });
  assert.equal(once.score, twice.score);
  const across = assess({ message: mod(ind("dup", 4)), url: mod(ind("dup", 4)) });
  assert.equal(across.evidence.length, 1);
  assert.deepEqual(across.evidence[0].seenIn.sort(), ["message", "url"]);
  assert.equal(across.score, once.score);
});

test("one module cannot push the total beyond its cap on its own", () => {
  const many = assess({ message: mod(...Array.from({ length: 30 }, (_, i) => ind("m" + i, 5))) });
  const few = assess({ message: mod(ind("a", 7), ind("b", 7)) });
  assert.equal(many.score, few.score);
  assert.ok(many.score < 100);
});

test("two kinds of check agreeing give higher confidence than one", () => {
  const one = assess({ message: mod(ind("a", 3), ind("b", 3)) });
  const two = assess({ message: mod(ind("a", 3)), url: mod(ind("b", 3)) });
  assert.equal(two.score, one.score);
  assert.equal(two.confidence.level, "HIGH");
  assert.notEqual(one.confidence.level, "HIGH");
});

test("good signs lower the result, but by no more than half, and never when something critical was found", () => {
  const plain = assess({ message: mod(ind("a", 3), ind("b", 3)) });
  const mitigated = assess({ message: mod(ind("a", 3), ind("b", 3), ind("good", -10)) });
  assert.ok(mitigated.score < plain.score);
  assert.ok(mitigated.score >= assess({ message: mod(ind("a", 3)) }).score - 1, "at most half of 6 points was removed");
  assert.ok(mitigated.conflicts.length >= 1, "the conflict is explained");
  const critical = assess({ message: mod(ind("c", 9, { critical: true }), ind("good", -10)) });
  assert.equal(critical.score, assess({ message: mod(ind("c", 9, { critical: true })) }).score);
  assert.match(critical.conflicts[0], /critical/i);
  assert.equal(assess({ message: mod(ind("good", -5)) }).score, 0);
});

test("invalid indicators are dropped, not trusted", () => {
  const a = assess({
    message: mod(null, 5, "x", {}, { id: "", label: "x", weight: 3 }, { id: "bad id!", label: "x", weight: 3 }, { id: "ok1", label: "", weight: 3 }, { id: "ok2", label: "x" }, { id: "ok3", label: "x", severity: "nonsense" }, ind("good", 3)),
  });
  assert.deepEqual(a.evidence.map((e) => e.id), ["good"]);
});

test("a single indicator weight is capped, so a hostile detector cannot dominate", () => {
  const a = assess({ message: mod(ind("big", 1e6), ind("small", 1)) });
  assert.ok(a.evidence.find((e) => e.id === "big").points <= R.LIMITS.maxIndicatorWeight);
});

test("explanations and advice come from the evidence actually found", () => {
  const otp = assess({ message: mod(ind("msg_otp_request", 6), ind("msg_urgency", 1.2)) });
  assert.ok(otp.reasons.some((r) => r.text === "Label msg_otp_request"));
  assert.ok(otp.actions.some((l) => /never share your otp/i.test(l)));
  const none = assess({ message: mod(ind("msg_urgency", 1.2)) });
  assert.ok(!none.actions.some((l) => /never share your otp/i.test(l)), "no OTP advice without an OTP sign");
  assert.deepEqual(none.reasons.map((r) => r.text), ["Label msg_urgency"]);
  assert.equal(none.actions.length, 1, "a LOW result carries only the general advice");
});

test("the result has every field the spec asks for, and an injected clock is used", () => {
  const a = assess({ message: mod(ind("a", 3), ind("b", 3)) });
  for (const key of ["score", "category", "confidence", "evidence", "reasons", "availableModules", "unavailableModules", "recommendedAction", "analysisTimestamp"]) assert.ok(key in a, key);
  assert.equal(a.analysisTimestamp, "2026-01-01T00:00:00.000Z");
  assert.equal(typeof E.assess({ message: mod() }).analysisTimestamp, "string");
  assert.match(a.scoreMeaning, /not the probability/i);
  assert.equal(a.recommendedAction, a.actions[0]);
});

test("the engine is deterministic and does not remember anything between calls", () => {
  const input = { message: mod(ind("a", 3), ind("b", 2)) };
  const first = JSON.stringify(assess(input));
  for (let i = 0; i < 5; i++) assert.equal(JSON.stringify(assess(input)), first);
  const copy = JSON.parse(JSON.stringify(input));
  assess(input);
  assert.deepEqual(input, copy, "the input is never changed");
});

#!/usr/bin/env node
/*
 * Prevenza: measure detection on a HELD-OUT set (Step 12).
 *
 *   npm run eval:holdout                     reads data/holdout/*.jsonl
 *   node scripts/evaluate-holdout.js <dir>   reads another folder
 *
 * This is the only place an accuracy number may come from. The rules in this project were written from invented
 * examples (scripts/detection-check.js), so those can never measure accuracy. A held-out set must be collected
 * BEFORE anyone looks at how the rules treat it, and the rules must never be changed to fit it. See data/holdout/README.md.
 *
 * Each line of a .jsonl file is one example:
 *   {"kind":"message","label":"scam","text":"...","source":"...","collected":"2026-11"}
 *   {"kind":"url","label":"legit","url":"https://...","source":"...","collected":"2026-11"}
 *   {"kind":"upi","label":"scam","payment":{"upiId":"...","amount":"...","reason":"..."},"source":"...","collected":"2026-11"}
 * label is "scam" or "legit". A result of MEDIUM or higher counts as a warning. INCONCLUSIVE is reported separately
 * and never counted as correct for either label.
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
const urlIntel = require("../src/shared/url-intel.js");
const messageScan = require("../src/shared/message-scan.js");
const upiAnalyze = require("../src/shared/upi-analyze.js");
const riskEngine = require("../src/shared/risk-engine.js");

const MIN_EXAMPLES = 50; // below this, no rates are printed: the numbers would mean almost nothing
const WARN = new Set(["MEDIUM", "HIGH", "CRITICAL"]);

/** Reads every .jsonl file in a folder. Returns { examples, problems }. Never throws on a bad line. */
function load(dir) {
  const examples = [];
  const problems = [];
  if (!fs.existsSync(dir)) return { examples, problems: ["folder not found: " + dir] };
  for (const name of fs.readdirSync(dir).filter((n) => n.endsWith(".jsonl")).sort()) {
    const lines = fs.readFileSync(path.join(dir, name), "utf8").split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!line.trim()) return;
      let ex;
      try {
        ex = JSON.parse(line);
      } catch (e) {
        problems.push(name + ":" + (i + 1) + " is not valid JSON");
        return;
      }
      const why = invalid(ex);
      if (why) problems.push(name + ":" + (i + 1) + " " + why);
      else examples.push(Object.assign({ file: name, line: i + 1 }, ex));
    });
  }
  return { examples, problems };
}

function invalid(ex) {
  if (!ex || typeof ex !== "object") return "is not an object";
  if (!["message", "url", "upi"].includes(ex.kind)) return "has an unknown kind";
  if (!["scam", "legit"].includes(ex.label)) return "needs label scam or legit";
  if (ex.kind === "message" && typeof ex.text !== "string") return "needs text";
  if (ex.kind === "url" && typeof ex.url !== "string") return "needs url";
  if (ex.kind === "upi" && (!ex.payment || typeof ex.payment !== "object")) return "needs payment";
  return null;
}

/** The engine's category for one example, through the same modules the extension uses. */
function categoryOf(ex) {
  if (ex.kind === "url") {
    const r = urlIntel.analyzeUrl(ex.url);
    if (!r.ok) return "REJECTED";
    return riskEngine.assess({ url: { ok: true, indicators: r.indicators } }).category;
  }
  if (ex.kind === "message") {
    const s = messageScan.scanMessage(ex.text);
    if (!s.ok) return "REJECTED";
    if (s.unsupportedScript && !s.indicators.some((i) => i.weight > 0)) return "INCONCLUSIVE";
    return riskEngine.assess({ message: { ok: true, indicators: s.indicators } }).category;
  }
  const u = upiAnalyze.analyzeUpi(ex.payment, { messageScan });
  if (!u.ok) return "REJECTED";
  return riskEngine.assess({ payment: { ok: true, indicators: u.indicators } }).category;
}

/** Wilson score interval for a proportion (95%). Honest about small samples. */
function wilson(successes, n) {
  if (n === 0) return null;
  const z = 1.96;
  const p = successes / n;
  const d = 1 + (z * z) / n;
  const centre = (p + (z * z) / (2 * n)) / d;
  const half = (z * Math.sqrt((p * (1 - p)) / n + (z * z) / (4 * n * n))) / d;
  return [Math.max(0, centre - half), Math.min(1, centre + half)];
}

function evaluate(examples) {
  const t = { tp: 0, fn: 0, tn: 0, fp: 0, inconclusiveScam: 0, inconclusiveLegit: 0, rejected: 0 };
  const byKind = {};
  const misses = [];
  for (const ex of examples) {
    const cat = categoryOf(ex);
    const k = (byKind[ex.kind] = byKind[ex.kind] || { scam: 0, legit: 0 });
    k[ex.label] += 1;
    if (cat === "REJECTED") t.rejected += 1;
    else if (cat === "INCONCLUSIVE") t[ex.label === "scam" ? "inconclusiveScam" : "inconclusiveLegit"] += 1;
    else if (ex.label === "scam") {
      if (WARN.has(cat)) t.tp += 1;
      else {
        t.fn += 1;
        misses.push({ type: "missed scam", file: ex.file, line: ex.line, category: cat });
      }
    } else if (WARN.has(cat)) {
      t.fp += 1;
      misses.push({ type: "false alarm", file: ex.file, line: ex.line, category: cat });
    } else t.tn += 1;
  }
  const scams = t.tp + t.fn + t.inconclusiveScam;
  const legit = t.tn + t.fp + t.inconclusiveLegit;
  return {
    total: examples.length,
    counts: t,
    byKind,
    scams,
    legit,
    enough: examples.length >= MIN_EXAMPLES && scams > 0 && legit > 0,
    detectionRate: scams ? t.tp / scams : null,
    detectionCI: wilson(t.tp, scams),
    falseAlarmRate: legit ? t.fp / legit : null,
    falseAlarmCI: wilson(t.fp, legit),
    misses,
  };
}

const pct = (x) => (x === null ? "-" : (x * 100).toFixed(1) + "%");
const ci = (c) => (c ? pct(c[0]) + " to " + pct(c[1]) : "-");

function report(result, problems) {
  const out = [];
  out.push("Prevenza held-out evaluation");
  out.push("Examples: " + result.total + " (" + result.scams + " scams, " + result.legit + " legitimate)");
  for (const [kind, k] of Object.entries(result.byKind)) out.push("  " + kind + ": " + k.scam + " scams, " + k.legit + " legitimate");
  if (problems.length) out.push("Skipped lines: " + problems.length + " (" + problems.slice(0, 3).join("; ") + (problems.length > 3 ? "; ..." : "") + ")");
  const c = result.counts;
  out.push("Counts: warned on " + c.tp + " scams, missed " + c.fn + ", inconclusive on " + c.inconclusiveScam + " scams");
  out.push("        quiet on " + c.tn + " legitimate, false alarms " + c.fp + ", inconclusive on " + c.inconclusiveLegit + " legitimate" + (c.rejected ? ", " + c.rejected + " inputs refused" : ""));
  if (!result.enough) {
    out.push("Not enough examples to report rates (need at least " + MIN_EXAMPLES + ", with both scams and legitimate ones). No accuracy figure can be claimed.");
  } else {
    out.push("Detection rate (scams warned on): " + pct(result.detectionRate) + "  (95% interval " + ci(result.detectionCI) + ")");
    out.push("False-alarm rate (legitimate warned on): " + pct(result.falseAlarmRate) + "  (95% interval " + ci(result.falseAlarmCI) + ")");
    out.push("Inconclusive results count as neither correct nor wrong. Report the date of this set and how it was collected next to these numbers.");
  }
  // Which lines were wrong is printed, never their content, so a shared log does not leak the examples.
  if (result.misses.length) out.push("Wrong results (file:line): " + result.misses.map((m) => m.file + ":" + m.line + " " + m.type + " (" + m.category + ")").join(", "));
  return out.join("\n");
}

module.exports = { load, evaluate, report, categoryOf, wilson, MIN_EXAMPLES };

if (require.main === module) {
  const dir = path.resolve(process.argv[2] || path.join(__dirname, "..", "data", "holdout"));
  const { examples, problems } = load(dir);
  console.log(report(evaluate(examples), problems));
}

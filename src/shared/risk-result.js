/*
 * Prevenza: the unified risk result summary (Step 10). Every checker on the dashboard shows the central risk engine's
 * assessment through this one component, so the score, category, confidence, evidence and recommended action always
 * look the same.
 *
 * It does NOT score anything. It only describes an assessment that risk-engine.js already made. There are no
 * thresholds here and no second scoring system.
 *
 * model(assessment)            pure: the words to show (runs in Node, unit tested)
 * render(assessment, opts)     DOM: builds the summary (text nodes only, never HTML)
 * problemText(reply)           pure: the sentence for a check that could not run. Never says or implies "safe".
 * record(assessment)           DOM: tells the background worker to add one to the counter for this category.
 *                              Only the category is sent. Nothing about the content.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.riskResult = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const CATEGORIES = Object.freeze(["LOW", "MEDIUM", "HIGH", "CRITICAL", "INCONCLUSIVE", "NOT_SCANNED"]);
  const NO_SCORE = Object.freeze({
    INCONCLUSIVE: "No warning level: there was not enough usable information to decide.",
    NOT_SCANNED: "No warning level: nothing has been checked yet.",
  });
  const NOT_SAFE = "Nothing was marked safe. Check it yourself with the real organisation before you act.";
  const CONFIDENCE_WORDS = Object.freeze({ HIGH: "High", MEDIUM: "Medium", LOW: "Low", NONE: "None" });

  function isObj(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  /** The words for an assessment. Anything missing or unreadable becomes NOT SCANNED, never LOW. */
  function model(assessment) {
    const a = isObj(assessment) ? assessment : null;
    const category = a && CATEGORIES.includes(a.category) ? a.category : "NOT_SCANNED";
    const hasScore = !!a && typeof a.score === "number" && Number.isFinite(a.score) && category !== "INCONCLUSIVE" && category !== "NOT_SCANNED";
    const reasons = a && Array.isArray(a.reasons) ? a.reasons.filter((r) => isObj(r) && typeof r.text === "string") : [];
    const conf = a && isObj(a.confidence) ? a.confidence : { level: "NONE", note: "" };
    const unavailable = a && Array.isArray(a.unavailableModules)
      ? a.unavailableModules.filter((m) => isObj(m) && typeof m.reason === "string" && m.reason !== "Not checked." && !/not built yet/i.test(m.reason)).map((m) => (m.label || m.id) + ": " + m.reason)
      : [];
    let evidence;
    if (!hasScore) evidence = "None that could be used.";
    else if (reasons.length === 0) evidence = "No warning signs in what was checked. This is not proof of safety.";
    else evidence = reasons.length + (reasons.length === 1 ? " warning sign: " : " warning signs, the strongest: ") + reasons.slice(0, 3).map((r) => r.text).join("; ") + ".";
    return {
      category,
      score: hasScore ? Math.round(a.score) : null,
      scoreText: hasScore ? "Warning level " + Math.round(a.score) + " of 100" : NO_SCORE[category] || NO_SCORE.NOT_SCANNED,
      scoreMeaning: hasScore && typeof a.scoreMeaning === "string" ? a.scoreMeaning : "",
      confidence: (CONFIDENCE_WORDS[conf.level] || "None") + (conf.note ? ". " + conf.note : ""),
      evidence,
      evidenceCount: hasScore ? reasons.length : 0,
      action: a && typeof a.recommendedAction === "string" && a.recommendedAction ? a.recommendedAction : NOT_SAFE,
      unavailable,
      notSafe: !hasScore ? NOT_SAFE : "",
      countable: category !== "NOT_SCANNED" && !!a,
    };
  }

  /** The sentence for a reply that did not produce an assessment. */
  function problemText(reply) {
    if (isObj(reply) && reply.error === "unavailable") return "This check is not available right now, so nothing was checked. That does not mean it is safe.";
    if (isObj(reply) && reply.error === "timeout") return "Prevenza took too long to answer, so nothing was checked. That does not mean it is safe. Please try again.";
    return "Prevenza could not check that right now. Please try again. Nothing was marked safe.";
  }

  function render(assessment, opts) {
    const o = opts || {};
    const H = self.Prevenza;
    const m = model(assessment);
    const el = (tag, className, text) => {
      const n = document.createElement(tag);
      if (className) n.className = className;
      if (text !== undefined) n.textContent = text;
      return n;
    };
    const box = el("section", "risk-summary");
    box.setAttribute("data-category", m.category);
    box.setAttribute("aria-label", o.label || "Result summary");

    const verdict = el("div", "verdict");
    const mascot = el("span");
    mascot.setAttribute("data-mascot", "40");
    mascot.setAttribute("aria-hidden", "true");
    const pill = el("span", "pill");
    if (H && H.ui) H.ui.setCategoryPill(pill, m.category);
    verdict.append(mascot, pill, el("span", m.score === null ? "score score-none" : "score", m.scoreText));
    box.appendChild(verdict);
    if (m.scoreMeaning) box.appendChild(el("p", "muted small", m.scoreMeaning + (o.meaningExtra ? " " + o.meaningExtra : "")));

    const facts = el("dl", "risk-facts");
    const add = (k, v, cls) => {
      facts.appendChild(el("dt", null, k));
      facts.appendChild(el("dd", cls || null, v));
    };
    add("Confidence", m.confidence);
    add("Evidence found", m.evidence);
    if (m.unavailable.length) add("Could not be checked", m.unavailable.join(" "));
    add("Recommended action", m.action, "risk-action");
    box.appendChild(facts);
    if (m.notSafe) {
      const n = el("p", "notice", m.notSafe);
      n.setAttribute("role", "note");
      box.appendChild(n);
    }
    if (H && H.ui) H.ui.placeMascots(box);
    return box;
  }

  /** Count this finished check (category only) and tell the dashboard, so the overview can update. Never throws. */
  function record(assessment) {
    const m = model(assessment);
    if (!m.countable) return Promise.resolve(false);
    const H = self.Prevenza;
    try {
      document.dispatchEvent(new CustomEvent("prevenza:checked", { detail: { category: m.category } }));
    } catch (e) {
      /* the overview is optional */
    }
    if (!H || !H.messaging) return Promise.resolve(false);
    return H.messaging.send({ type: H.MSG.RECORD_SCAN, payload: { category: m.category } }).then(
      (r) => {
        try {
          document.dispatchEvent(new CustomEvent("prevenza:stats", { detail: r && r.ok && r.stats ? { stats: r.stats } : {} }));
        } catch (e) {
          /* ignore */
        }
        return !!(r && r.ok);
      },
      () => false
    );
  }

  return { model, problemText, render, record, CATEGORIES, NOT_SAFE };
});

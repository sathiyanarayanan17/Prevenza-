/*
 * Prevenza: the CENTRAL risk engine. The only place where evidence becomes a score.
 * Pure functions: no storage, no network, no browser APIs. Nothing is remembered between calls.
 *
 * assess({ url, message, payment, screenshot, community }) -> assessment
 *
 * Each module result must look like:  { ok: true, indicators: [ { id, label, why, weight?, severity?, critical? } ] }
 * A module that is missing, invalid, failed or "not built yet" is listed as UNAVAILABLE. It is never counted as
 * "checked and safe". Adding a new detector means adding it to MODULES in risk-rules.js and passing its result in.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const rules = isNode ? require("./risk-rules.js") : root.Prevenza.riskRules;
  const api = factory(rules);
  if (isNode) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.riskEngine = api;
  }
})(typeof self !== "undefined" ? self : this, function (R) {
  "use strict";

  const L = R.LIMITS;
  const SCORE_MEANING = "This number is a warning level based on the signs found. It is not the probability that something is a scam.";
  const ID_RE = /^[A-Za-z0-9_.:-]+$/;

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  function clip(text, max) {
    return String(text).replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max);
  }

  function strengthWord(points, critical) {
    if (critical) return "critical";
    if (points < 0) return "mitigating";
    for (const s of R.STRENGTH_WORDS) if (points >= s.min) return s.word;
    return "none";
  }

  /** Turn one module's result into clean evidence, or say why it cannot be used. */
  function readModule(def, raw) {
    if (raw === undefined || raw === null) return { id: def.id, used: false, reason: def.available ? "Not checked." : def.reason || "Not available." };
    if (!def.available) return { id: def.id, used: false, reason: def.reason || "Not available." };
    if (!isPlainObject(raw)) return { id: def.id, used: false, reason: "The result could not be read.", invalid: true };
    if (raw.ok === false) return { id: def.id, used: false, reason: "This part could not be analysed.", failed: true };
    if (raw.unavailable === true) return { id: def.id, used: false, reason: clip(raw.reason || "Not available.", 160) };
    if (raw.ok !== true || !Array.isArray(raw.indicators)) return { id: def.id, used: false, reason: "The result could not be read.", invalid: true };

    const items = [];
    let dropped = 0;
    for (const ind of raw.indicators.slice(0, L.maxIndicatorsPerModule)) {
      if (!isPlainObject(ind) || typeof ind.id !== "string" || !ind.id || ind.id.length > L.maxIdLength || !ID_RE.test(ind.id) || typeof ind.label !== "string" || !ind.label.trim()) {
        dropped += 1;
        continue;
      }
      let weight = typeof ind.weight === "number" && Number.isFinite(ind.weight) ? ind.weight : R.SEVERITY_POINTS[ind.severity];
      if (typeof weight !== "number") {
        dropped += 1;
        continue;
      }
      weight = Math.max(-L.maxIndicatorWeight, Math.min(L.maxIndicatorWeight, weight));
      items.push({
        module: def.id,
        id: ind.id,
        label: clip(ind.label, L.maxTextLength),
        why: typeof ind.why === "string" ? clip(ind.why, L.maxTextLength) : "",
        points: weight,
        critical: ind.critical === true && weight > 0,
      });
    }
    return { id: def.id, used: true, items, dropped };
  }

  /** Same indicator reported twice (in one module or two) counts once, at its strongest. */
  function dedupe(items) {
    const byId = new Map();
    for (const it of items) {
      const prior = byId.get(it.id);
      if (!prior) {
        byId.set(it.id, Object.assign({}, it, { seenIn: [it.module] }));
        continue;
      }
      if (!prior.seenIn.includes(it.module)) prior.seenIn.push(it.module);
      if (Math.abs(it.points) > Math.abs(prior.points)) {
        prior.points = it.points;
        prior.label = it.label;
        prior.why = it.why;
        prior.module = it.module;
      }
      prior.critical = prior.critical || it.critical;
    }
    return [...byId.values()];
  }

  function pointsToScore(points) {
    if (points <= 0) return 0;
    const c = R.SCORE_CURVE;
    for (let i = 1; i < c.length; i++) {
      if (points <= c[i][0]) {
        const [x0, y0] = c[i - 1];
        const [x1, y1] = c[i];
        return y0 + ((y1 - y0) * (points - x0)) / (x1 - x0);
      }
    }
    return 100;
  }

  function categoryOf(score) {
    for (const c of R.CATEGORIES) if (score >= c.min && score <= c.max) return c.id;
    return score > 100 ? "CRITICAL" : "LOW";
  }

  function moduleLabel(id) {
    const m = R.MODULES.find((x) => x.id === id);
    return m ? m.label : id;
  }

  function actionLines(positiveEvidence, category) {
    const lines = [R.CATEGORY_ACTIONS[category]];
    if (category === "LOW") return lines;
    const seen = new Set();
    for (const e of positiveEvidence) {
      for (const hint of R.ACTION_HINTS) {
        if (!seen.has(hint.text) && hint.when.test(e.id)) {
          seen.add(hint.text);
          lines.push(hint.text);
        }
      }
    }
    return lines.slice(0, 5);
  }

  function emptyResult(category, now, extra) {
    return Object.assign(
      {
        score: null,
        category,
        status: category === "NOT_SCANNED" ? "not_scanned" : "inconclusive",
        confidence: { level: "NONE", note: category === "NOT_SCANNED" ? "Nothing was checked." : "There was not enough usable information." },
        evidence: [],
        reasons: [],
        conflicts: [],
        availableModules: [],
        unavailableModules: [],
        recommendedAction: R.CATEGORY_ACTIONS[category],
        actions: [R.CATEGORY_ACTIONS[category]],
        scoreMeaning: SCORE_MEANING,
        analysisTimestamp: now,
      },
      extra || {}
    );
  }

  /**
   * Combine whatever evidence is available into one assessment.
   * opts.now: optional function returning an ISO time string (for tests).
   */
  function assess(input, opts) {
    const nowFn = opts && typeof opts.now === "function" ? opts.now : () => new Date().toISOString();
    const now = nowFn();

    // Nothing usable to read: say so, and list every module as not checked (never as safe).
    const allUnavailable = () => R.MODULES.map((m) => ({ id: m.id, label: m.label, reason: m.available ? "Not checked." : m.reason || "Not available." }));
    if (input === undefined || input === null) return emptyResult("NOT_SCANNED", now, { unavailableModules: allUnavailable() });
    if (!isPlainObject(input)) {
      return emptyResult("INCONCLUSIVE", now, { confidence: { level: "NONE", note: "The input could not be read." }, unavailableModules: allUnavailable() });
    }

    const provided = R.MODULES.filter((m) => input[m.id] !== undefined && input[m.id] !== null);
    const reads = R.MODULES.map((def) => readModule(def, input[def.id]));
    const used = reads.filter((r) => r.used);

    const availableModules = used.map((r) => r.id);
    const unavailableModules = reads.filter((r) => !r.used).map((r) => ({ id: r.id, label: moduleLabel(r.id), reason: r.reason }));

    function finishUnavailable(result) {
      result.availableModules = availableModules;
      result.unavailableModules = unavailableModules;
      return result;
    }

    if (used.length === 0) {
      const category = provided.length === 0 ? "NOT_SCANNED" : "INCONCLUSIVE";
      return finishUnavailable(emptyResult(category, now));
    }

    // 1. Evidence, with duplicates removed and each module's contribution capped.
    const perModule = used.map((r) => {
      const unique = dedupe(r.items);
      let total = 0;
      for (const e of unique) if (e.points > 0) total += e.points;
      return { id: r.id, unique, total, scale: total > L.maxPointsPerModule ? L.maxPointsPerModule / total : 1 };
    });
    const merged = dedupe(perModule.flatMap((m) => m.unique));
    const scaleOf = new Map(perModule.map((m) => [m.id, m.scale]));

    const positive = merged.filter((e) => e.points > 0);
    const mitigating = merged.filter((e) => e.points < 0);
    const critical = positive.filter((e) => e.critical);

    let warningPoints = 0;
    for (const e of positive) warningPoints += e.points * (scaleOf.get(e.module) || 1);

    // 2. Good signs lower the total, but never by more than half, and never when something critical was found.
    let mitigationPoints = 0;
    const conflicts = [];
    if (mitigating.length > 0) {
      const wanted = mitigating.reduce((s, e) => s - e.points, 0);
      if (critical.length > 0) {
        conflicts.push("Some signs looked genuine, but a critical warning sign was also found, so the genuine signs were not used to lower the result.");
      } else {
        mitigationPoints = Math.min(wanted, warningPoints * L.mitigationShare);
        if (positive.some((e) => e.points >= 2) && mitigationPoints > 0) {
          conflicts.push("Some signs looked genuine and some looked suspicious. The result was lowered a little, not removed.");
        }
      }
    }

    // 3. Score.
    const netPoints = Math.max(0, warningPoints - mitigationPoints);
    let score = Math.min(100, Math.floor(pointsToScore(netPoints) + 1e-9));
    if (positive.length === 1 && critical.length === 0) score = Math.min(score, L.singleIndicatorMaxScore); // one weak sign is never proof
    if (critical.length > 0) score = Math.max(score, L.criticalFloor);
    const category = categoryOf(score);

    // 4. Confidence: how much real evidence stands behind the number.
    const familiesWithWarnings = new Set(positive.filter((e) => e.points >= 2).flatMap((e) => e.seenIn)).size;
    let level;
    let note;
    if (critical.length > 0 || familiesWithWarnings >= 2) {
      level = "HIGH";
      note = critical.length > 0 ? "A clear, serious warning sign was found." : "More than one kind of check found warning signs.";
    } else if (positive.length >= 2 || score >= 25) {
      level = "MEDIUM";
      note = "Several warning signs were found by one kind of check.";
    } else {
      level = "LOW";
      note = positive.length === 0
        ? "Only " + availableModules.map(moduleLabel).join(" and ").toLowerCase() + " was checked, and nothing stood out. This is not proof of safety."
        : "Only a minor sign was found. There is little evidence either way.";
    }
    if (conflicts.length > 0 && level === "HIGH" && critical.length === 0) level = "MEDIUM";

    // 5. Evidence list, explanations, action. All generated from the real indicators.
    const ordered = merged.slice().sort((a, b) => (b.critical ? 1 : 0) - (a.critical ? 1 : 0) || b.points - a.points);
    const evidence = ordered.slice(0, L.maxEvidenceListed).map((e) => ({
      id: e.id,
      module: e.module,
      moduleLabel: moduleLabel(e.module),
      label: e.label,
      why: e.why,
      points: Math.round(e.points * 10) / 10,
      strength: strengthWord(e.points, e.critical),
      seenIn: e.seenIn.slice(),
    }));
    const reasons = ordered
      .filter((e) => e.points > 0)
      .slice(0, L.maxReasons)
      .map((e) => ({ text: e.label, detail: e.why, module: e.module, moduleLabel: moduleLabel(e.module), strength: strengthWord(e.points, e.critical) }));

    const actions = actionLines(ordered.filter((e) => e.points > 0), category);

    return {
      score,
      category,
      status: "scanned",
      confidence: { level, note },
      evidence,
      reasons,
      conflicts,
      availableModules,
      unavailableModules,
      recommendedAction: actions[0],
      actions,
      scoreMeaning: SCORE_MEANING,
      analysisTimestamp: now,
    };
  }

  return { assess, pointsToScore, categoryOf, SCORE_MEANING };
});

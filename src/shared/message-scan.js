/*
 * Prevenza: offline message scanner (Step 4).
 * Pure functions: no storage, no network, no browser APIs, and nothing is remembered between calls.
 *
 * scanMessage(text, { language }) looks at text the user pasted and returns:
 *   - indicators   in the format the central risk engine (risk-engine.js) expects, so it can turn them into a score
 *   - highlights   character ranges in the pasted text, so the page can mark the suspicious phrases
 *   - categories   which kinds of scam the signs point to
 *   - language     a best guess at the language (never a certainty)
 * It does not score anything itself. The score, category and advice come from risk-engine.js, the only scoring place.
 *
 * Privacy: the returned object holds rule wording and character positions, never a copy of the message.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const rules = isNode ? require("./message-rules.js") : root.Prevenza.messageRules;
  const api = factory(rules);
  if (isNode) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.messageScan = api;
  }
})(typeof self !== "undefined" ? self : this, function (R) {
  "use strict";

  const L = R.LIMITS;
  const SETS = ["en", "hi", "ta", "hr", "tr"];
  const LANGUAGE_CHOICES = ["auto", "en", "hi", "ta", "hinglish"];
  const LANGUAGE_NOTE = "A best guess from the letters and common words. It can be wrong, especially for short or mixed messages.";

  // Invisible characters, soft hyphens, and Devanagari accent marks that people type inconsistently.
  const IGNORED = /[\u00ad\u200b-\u200f\u202a-\u202e\u2060-\u2064\ufeff\u0951-\u0954\u093c]/;

  // ---------------------------------------------------------------- compile the rules once
  function compileAll(list) {
    return list.map((sig) => {
      const sets = {};
      for (const name of SETS) sets[name] = ((sig.patterns && sig.patterns[name]) || []).map((src) => new RegExp(src, "gu"));
      return {
        sig,
        sets,
        negBefore: sig.negate && sig.negate.before ? new RegExp(sig.negate.before, "u") : null,
        negAfter: sig.negate && sig.negate.after ? new RegExp(sig.negate.after, "u") : null,
      };
    });
  }
  const COMPILED = compileAll(R.SIGNALS);
  const COMPILED_PAYMENT = compileAll(R.PAYMENT_SIGNALS);

  // ---------------------------------------------------------------- normalising text
  /**
   * Lowercase, fold look-alike letters, drop invisible characters and collapse spaces.
   * Returns the cleaned text plus, for every cleaned character, where it started and ended in the original.
   * That map lets the page highlight the user's own words even after cleaning.
   */
  function normalize(input) {
    const out = [];
    const starts = [];
    const ends = [];
    let pos = 0;
    for (const ch of String(input)) {
      const s = pos;
      pos += ch.length;
      if (IGNORED.test(ch)) continue;
      const folded = ch.normalize("NFKC").toLowerCase().replace(/\u0901/g, "\u0902");
      let mapped = "";
      for (const c of folded) mapped += R.CONFUSABLES[c] || c;
      for (const c of mapped) {
        if (/\s/u.test(c)) {
          if (out.length === 0) continue;
          if (out[out.length - 1] === " ") {
            ends[ends.length - 1] = pos;
            continue;
          }
          out.push(" ");
          starts.push(s);
          ends.push(pos);
          continue;
        }
        for (let k = 0; k < c.length; k++) {
          out.push(c[k]);
          starts.push(s);
          ends.push(pos);
        }
      }
    }
    while (out.length && out[out.length - 1] === " ") {
      out.pop();
      starts.pop();
      ends.pop();
    }
    return { text: out.join(""), starts, ends };
  }

  // ---------------------------------------------------------------- language
  function countWords(tokens, list) {
    const seen = new Set();
    for (const t of tokens) if (list.has(t)) seen.add(t);
    return seen.size;
  }

  /** A best guess at the language of already-normalised text. */
  function detectLanguage(norm) {
    let dev = 0;
    let tam = 0;
    let lat = 0;
    for (const c of norm) {
      const cp = c.codePointAt(0);
      if (cp >= 0x0900 && cp <= 0x0963) dev += 1;
      else if (cp >= 0x0b80 && cp <= 0x0be5) tam += 1;
      else if (cp >= 97 && cp <= 122) lat += 1;
    }
    const total = dev + tam + lat;
    const base = { romanized: false, mixed: false, scripts: [], confidence: "low", note: LANGUAGE_NOTE, letters: total, hasDevanagari: dev > 0, hasTamil: tam > 0 };
    if (total === 0) return Object.assign(base, { id: "unknown", label: R.LANGUAGE_LABELS.unknown });

    // A script counts as present when at least two of its letters appear, so one Hindi word inside an English
    // message still marks it as mixed.
    const scripts = [];
    if (lat >= 2) scripts.push("latin");
    if (dev >= 2) scripts.push("devanagari");
    if (tam >= 2) scripts.push("tamil");
    const tokens = norm.match(/[a-z]+/g) || [];
    const hindiHits = countWords(tokens, R.HINGLISH_WORDS);
    const tamilHits = countWords(tokens, R.TAMIL_ROMAN_WORDS);
    const englishHits = countWords(tokens, R.ENGLISH_WORDS);

    let id;
    let romanized = false;
    let confidence;
    const biggest = Math.max(dev, tam, lat);
    if (biggest === dev) {
      id = "hi";
      confidence = dev / total >= 0.8 && total >= 15 ? "high" : "medium";
    } else if (biggest === tam) {
      id = "ta";
      confidence = tam / total >= 0.8 && total >= 15 ? "high" : "medium";
    } else if (hindiHits >= 2 && hindiHits >= tamilHits) {
      id = "hinglish";
      confidence = hindiHits >= 3 ? "high" : "medium";
    } else if (tamilHits >= 2 && tamilHits > hindiHits) {
      id = "ta";
      romanized = true;
      confidence = tamilHits >= 3 ? "high" : "medium";
    } else if (englishHits >= 1) {
      id = "en";
      confidence = englishHits >= 4 && total >= 15 ? "high" : englishHits >= 2 ? "medium" : "low";
    } else {
      return Object.assign(base, { id: "unknown", label: R.LANGUAGE_LABELS.unknown, scripts });
    }
    if (total < 15) confidence = "low";
    const mixed = scripts.length >= 2 || ((id === "hinglish" || romanized) && englishHits >= 3);
    const label = id === "ta" && romanized ? R.LANGUAGE_LABELS.ta_roman : R.LANGUAGE_LABELS[id];
    return Object.assign(base, { id, label, romanized, mixed, scripts, confidence });
  }

  /**
   * Which pattern sets run. English always runs. A script's set runs whenever that script appears.
   * Romanised Hindi or Tamil rules run when the user chose that language, when the text looks like it, or on "auto".
   * So a wrong language choice never switches a check off.
   */
  function activeSets(selected, detected) {
    const sets = new Set(["en"]);
    if (detected.hasDevanagari) sets.add("hi");
    if (detected.hasTamil) sets.add("ta");
    if (detected.id === "hinglish") sets.add("hr");
    if (detected.id === "ta" && detected.romanized) sets.add("tr");
    if (selected === "hi" || selected === "hinglish") {
      sets.add("hr");
      sets.add("hi");
    }
    if (selected === "ta") {
      sets.add("tr");
      sets.add("ta");
    }
    if (selected === "auto") {
      sets.add("hr");
      sets.add("tr");
    }
    return sets;
  }

  function languageNote(selected, detected) {
    if (selected === "auto" || detected.confidence === "low" || detected.id === "unknown") return "";
    const compatible = { en: ["en"], hi: ["hi", "hinglish"], hinglish: ["hinglish", "hi"], ta: ["ta"] };
    if ((compatible[selected] || []).includes(detected.id)) return "";
    return "You chose a different language from the one the text looks like. Prevenza checked for both, so nothing was skipped.";
  }

  // ---------------------------------------------------------------- matching
  function isNegated(cs, text, start, end) {
    if (cs.negBefore && cs.negBefore.test(text.slice(Math.max(0, start - L.negateWindowBefore), end))) return true;
    if (cs.negAfter && cs.negAfter.test(text.slice(end, end + L.negateWindowAfter))) return true;
    return false;
  }

  function mergeRanges(ranges) {
    const sorted = ranges.slice().sort((a, b) => a.start - b.start || a.end - b.end);
    const merged = [];
    for (const r of sorted) {
      const last = merged[merged.length - 1];
      if (last && r.start <= last.end) {
        last.end = Math.max(last.end, r.end);
        for (const id of r.ids) if (!last.ids.includes(id)) last.ids.push(id);
      } else {
        merged.push({ start: r.start, end: r.end, ids: r.ids.slice() });
      }
    }
    return merged.slice(0, L.maxHighlights);
  }

  function fail(error, message) {
    return { ok: false, error, message };
  }

  /**
   * Analyse text the user pasted. Never throws.
   * opts.language: "auto" (default), "en", "hi", "ta" or "hinglish".
   */
  function scanMessage(input, opts) {
    try {
      if (typeof input !== "string") return fail("invalid", "That could not be read as text.");
      if (input.trim().length === 0) return fail("empty", "Paste a message first, then press Check.");
      const options = opts && typeof opts === "object" ? opts : {};
      const selected = LANGUAGE_CHOICES.includes(options.language) ? options.language : "auto";

      let text = input;
      let truncated = false;
      if (text.length > L.maxChars) {
        let cut = L.maxChars;
        const code = text.charCodeAt(cut - 1);
        if (code >= 0xd800 && code <= 0xdbff) cut -= 1; // do not split an emoji in half
        text = text.slice(0, cut);
        truncated = true;
      }

      const norm = normalize(text);
      const detected = detectLanguage(norm.text);
      const sets = activeSets(selected, detected);

      const indicators = [];
      const ranges = [];
      const points = new Map();
      // opts.payment: the text is the reason for a UPI payment (Step 5). Payment-only signals are added, and the two
      // "send money" signals are left out because the payment itself is the request.
      const active = options.payment === true
        ? COMPILED.filter((cs) => !R.PAYMENT_CONTEXT_SKIP.includes(cs.sig.id)).concat(COMPILED_PAYMENT)
        : COMPILED;
      for (const cs of active) {
        const hits = [];
        for (const name of SETS) {
          if (!sets.has(name)) continue;
          for (const re of cs.sets[name]) {
            re.lastIndex = 0;
            let count = 0;
            let m;
            while (count < L.maxMatchesPerPattern && (m = re.exec(norm.text)) !== null) {
              count += 1;
              if (m[0].length === 0) {
                re.lastIndex += 1;
                continue;
              }
              const start = m.index;
              const end = m.index + m[0].length;
              hits.push({ start, end, negated: isNegated(cs, norm.text, start, end) });
            }
          }
        }
        if (hits.length === 0) continue;

        const live = hits.filter((h) => !h.negated);
        const sig = cs.sig;
        let weight;
        let critical = false;
        if (live.length > 0) {
          weight = sig.weight;
          critical = sig.critical === true;
        } else if (sig.negate && sig.negate.weight > 0) {
          weight = sig.negate.weight; // an awareness message: shown as a note, not as a warning
        } else {
          continue;
        }
        indicators.push({ id: sig.id, label: sig.label, why: sig.why, weight, critical });
        if (weight > 0) for (const c of sig.categories) points.set(c, (points.get(c) || 0) + weight);
        if (live.length > 0 && weight > 0) {
          for (const h of live) ranges.push({ start: norm.starts[h.start], end: norm.ends[h.end - 1], ids: [sig.id] });
        }
      }

      const ranked = R.CATEGORIES.map((c) => ({ id: c.id, label: c.label, points: Math.round((points.get(c.id) || 0) * 10) / 10 }))
        .filter((c) => c.points > 0)
        .sort((a, b) => b.points - a.points);
      const primary = ranked.length > 0 && ranked[0].points >= L.minCategoryPoints ? ranked[0] : null;
      const others = ranked.filter((c) => c !== primary && c.points >= L.minSecondaryPoints);

      return {
        ok: true,
        language: Object.assign({ selected }, pick(detected, ["id", "label", "romanized", "mixed", "scripts", "confidence", "note"])),
        languageNote: languageNote(selected, detected),
        indicators,
        highlights: mergeRanges(ranges),
        primaryCategory: primary ? { id: primary.id, label: primary.label } : null,
        otherCategories: others.map((c) => ({ id: c.id, label: c.label })),
        truncated,
        analysedLength: text.length,
        shortText: detected.letters < L.shortTextLetters,
      };
    } catch (e) {
      return fail("internal", "This message could not be checked.");
    }
  }

  function pick(obj, keys) {
    const out = {};
    for (const k of keys) out[k] = obj[k];
    return out;
  }

  // ---------------------------------------------------------------- links inside a message
  const SCHEME_RE = /^(?:https?:\/\/|www\.)/i;
  const BARE_RE = /^[a-z0-9][a-z0-9.-]*\.([a-z]{2,24})(?:[/?#:]\S*)?$/i;

  /**
   * Web addresses written in the text, so the URL checker can look at them too. At most maxLinks.
   * The caller checks them in memory and must not keep them.
   */
  function extractLinks(input) {
    if (typeof input !== "string") return [];
    const text = input.slice(0, L.maxChars);
    const found = [];
    for (const raw of text.split(/[\s<>"'`]+/)) {
      if (found.length >= L.maxLinks) break;
      const token = raw.replace(/^[([{,;:!?.]+/, "").replace(/[)\]},;:!?.]+$/, "");
      if (token.length < 4 || token.length > 2048) continue;
      let ok = SCHEME_RE.test(token);
      if (!ok && !token.includes("@")) {
        const m = BARE_RE.exec(token);
        ok = !!m && R.LINK_ENDINGS.includes(m[1].toLowerCase());
      }
      if (ok && !found.includes(token)) found.push(token);
    }
    return found;
  }

  return { scanMessage, normalize, detectLanguage, extractLinks, LANGUAGE_CHOICES };
});

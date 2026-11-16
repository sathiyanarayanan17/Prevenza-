/*
 * Prevenza: Prevy's intervention logic (Step 7). Pure function, no DOM, no storage, no network.
 *
 * build(assessment, { context, language, elder }) turns a result from the central risk engine (risk-engine.js) into
 * what Prevy should say. It never scores anything: the tier comes straight from the engine's category.
 *   context:  "url" | "message" | "upi" | "screenshot"   (what the user checked)
 *   language: "en" | "hi" | "ta"                         (falls back to English)
 *   elder:    true shows one simple explanation and one sign instead of three, and (Step 8) adds model.elder: the plain
 *             "what we found / why it can be dangerous / what to do now" text from elder-text.js. Without elder it is null.
 *
 * Every headline and explanation is picked from the evidence ids the engine returned. Nothing is said about a kind of
 * risk unless matching evidence exists. The model holds rule wording only, never the text, address or payment checked.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const text = isNode ? require("./holdy-text.js") : root.Prevenza.holdyText;
  const elderText = isNode ? require("./elder-text.js") : root.Prevenza.elderText;
  const api = factory(text, elderText);
  if (isNode) module.exports = api;
  else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.holdy = api;
  }
})(typeof self !== "undefined" ? self : this, function (T, E) {
  "use strict";

  const CONTEXTS = ["url", "message", "upi", "screenshot"];
  const TIER_OF = { LOW: "info", MEDIUM: "caution", HIGH: "warning", CRITICAL: "stop", INCONCLUSIVE: "uncertain" };
  const LEVEL_LABEL = { LOW: "Low risk", MEDIUM: "Medium risk", HIGH: "High risk", CRITICAL: "Critical risk", INCONCLUSIVE: "Inconclusive" };

  // Headlines in priority order. "only" limits a rule to some contexts. The first rule whose evidence matches wins.
  const HEADLINES = [
    { when: /otp|pin|credential/, key: { message: "h_otp_message", screenshot: "h_otp_screenshot", upi: "h_otp_upi" }, fallback: "h_otp", needs: { message: /urgency/ } },
    { when: /receive_money|pay_to_receive|collect|refund/, key: "h_receive" },
    { when: /safe_account|custody/, key: "h_safe" },
    { when: /digital_arrest|authority_threat/, key: "h_arrest" },
    { when: /release_goods/, key: "h_release" },
    { when: /kyc|parcel|customer_care/, key: "h_fee" },
    { module: "url", key: "h_url" },
    { when: /payment_instruction|money_request|advance_fee|screenshot_claim/, only: ["screenshot"], key: "h_screenshot_pay" },
  ];

  // Short plain-language lines, matched to evidence ids. Order decides which come first.
  const SIMPLE = [
    [/^brand_|homograph|idn|lookalike|typosquat|misleading_subdomain|at_sign|credentials|backslash|restricted_suffix/, "s_lookalike", "url"],
    [/shortener|ip_public|ip_disguised|redirect|free_hosting|encoded|unusual_port|many_subdomains|long_hostname|many_hyphens|suspicious_tld|keywords/, "s_hidden_link", "url"],
    [/otp|pin|credential/, "s_secret"],
    [/safe_account|custody/, "s_safe"],
    [/digital_arrest|authority|isolation|impersonation/, "s_police"],
    [/receive_money|pay_to_receive|collect|refund|advance_fee|prize/, "s_pay_first"],
    [/kyc/, "s_kyc"],
    [/parcel|customs/, "s_parcel"],
    [/customer_care|remote_access/, "s_helpline"],
    [/upi_qr_(?:collect|autopay|recipient)/, "s_upi_code"],
    [/upi_(?:id|name|handle)/, "s_upi_name"],
    [/amount/, "s_amount"],
    [/release_goods|screenshot_claim/, "s_screenshot"],
    [/money_request|emergency|payment_instruction|wrong_transfer/, "s_money"],
    [/urgency/, "s_rush"],
  ];

  function lang(language) {
    return T[language] ? language : "en";
  }

  function say(language, key, vars) {
    let s = (T[language] && T[language][key]) || T.en[key] || "";
    if (vars) for (const [k, v] of Object.entries(vars)) s = s.split("{" + k + "}").join(v);
    return s;
  }

  function positiveEvidence(assessment) {
    return Array.isArray(assessment.evidence) ? assessment.evidence.filter((e) => e && typeof e.id === "string" && e.points > 0) : [];
  }

  function pickHeadline(evidence, context) {
    const ids = evidence.map((e) => e.id);
    for (const rule of HEADLINES) {
      if (rule.only && !rule.only.includes(context)) continue;
      const hit = rule.module ? evidence.some((e) => (e.seenIn || [e.module]).includes(rule.module)) : ids.some((id) => rule.when.test(id));
      if (!hit) continue;
      if (typeof rule.key === "string") return rule.key;
      const special = rule.key[context];
      const need = rule.needs && rule.needs[context];
      if (special && (!need || ids.some((id) => need.test(id)))) return special;
      return rule.fallback;
    }
    return "h_default_" + context;
  }

  function simpleLines(evidence, language, max) {
    const keys = [];
    for (const e of evidence) {
      for (const [re, key, module] of SIMPLE) {
        if (module && !(e.seenIn || [e.module]).includes(module)) continue;
        if (re.test(e.id)) {
          if (!keys.includes(key)) keys.push(key);
          break;
        }
      }
    }
    return keys.slice(0, max).map((k) => say(language, k));
  }

  // Elder Mode (Step 8): each headline belongs to one plain-language topic in elder-text.js.
  const TOPIC_OF_HEADLINE = {
    h_otp: "secret", h_otp_message: "secret", h_otp_screenshot: "secret", h_otp_upi: "secret",
    h_receive: "receive", h_safe: "safe_account", h_arrest: "arrest", h_release: "release_goods", h_fee: "fee",
    h_screenshot_pay: "screenshot_pay",
    h_default_message: "message", h_default_upi: "upi", h_default_screenshot: "screenshot",
  };
  const LOOKALIKE_ID = SIMPLE[0][0];

  // A few headlines are broad. The evidence decides which plain explanation fits best.
  const REFINE_FEE = [[/kyc|parcel/, "fee"], [/customer_care|remote_access/, "helpline"]];
  const REFINE_DEFAULT = [[/advance_fee|prize/, "receive"], [/money_request|payment_instruction|emergency|wrong_transfer/, "money_request"]];
  function refine(rules, evidence, fallback) {
    for (const [re, topic] of rules) if (evidence.some((e) => re.test(e.id))) return topic;
    return fallback;
  }

  function elderTopic(headlineKey, evidence) {
    if (headlineKey === "h_url" || headlineKey === "h_default_url") {
      const fake = evidence.some((e) => (e.seenIn || [e.module]).includes("url") && LOOKALIKE_ID.test(e.id));
      return fake ? "site_fake" : "site_odd";
    }
    if (headlineKey === "h_fee") return refine(REFINE_FEE, evidence, "fee");
    if (headlineKey === "h_default_message") return refine(REFINE_DEFAULT, evidence, "message");
    return TOPIC_OF_HEADLINE[headlineKey] || "message";
  }

  /** The plain explanation for a warning card: what was found, why it can hurt, and one or two next steps. */
  function elderCard(language, topic) {
    const set = E[language] || E.en;
    const t = set.topics[topic] || E.en.topics[topic] || E.en.topics.message;
    return { topic, found: t.found, why: t.why, steps: t.steps.slice(0, 2), labels: set.labels, family: set.family };
  }

  /** The extra line for the small notes (LOW and INCONCLUSIVE). It never says the result is safe. */
  function elderNote(language, tier) {
    const set = E[language] || E.en;
    return { extra: tier === "uncertain" ? set.labels.noteUnsure : set.labels.noteLow, trust: tier === "uncertain", labels: set.labels, family: set.family };
  }

  function actionsFor(context, language) {
    if (context === "upi") return ["a_review_upi", "a_cancel_upi", "a_family_upi", "a_continue_upi"].map((k) => say(language, k));
    return ["a_review", "a_cancel_" + context, "a_verify", "a_family", "a_continue"].map((k) => say(language, k));
  }

  /** A fingerprint of the result that holds no content: what was checked, the level, and which rules fired. */
  function keyOf(assessment, context, evidence) {
    return [context, assessment.category, evidence.map((e) => e.id).sort().join(",")].join("|");
  }

  function build(assessment, opts) {
    const o = opts || {};
    const context = CONTEXTS.includes(o.context) ? o.context : "message";
    const language = lang(o.language);
    const elder = o.elder === true;
    const base = { context, language, partial: language !== "en" };

    if (!assessment || typeof assessment !== "object" || !TIER_OF[assessment.category]) {
      return Object.assign(base, { tier: "none", show: false, key: context + "|none" });
    }
    const category = assessment.category;
    const tier = TIER_OF[category];
    const evidence = positiveEvidence(assessment);
    const common = Object.assign(base, { tier, category, levelLabel: LEVEL_LABEL[category], tierLabel: say(language, "tier_" + tier), key: keyOf(assessment, context, evidence) });

    if (tier === "info") return Object.assign(common, { show: "note", note: say(language, "note_low"), elder: elder ? elderNote(language, tier) : null });
    if (tier === "uncertain") return Object.assign(common, { show: "note", note: say(language, "note_uncertain"), elder: elder ? elderNote(language, tier) : null });

    const leadKey = tier === "stop" ? (context === "upi" ? "lead_stop_upi" : "lead_stop") : "lead_hold";
    const signs = evidence.slice().sort((a, b) => (b.strength === "critical" ? 1 : 0) - (a.strength === "critical" ? 1 : 0) || b.points - a.points);
    const headlineKey = pickHeadline(evidence, context);
    return Object.assign(common, {
      show: "card",
      urgent: tier === "warning" || tier === "stop",
      lead: say(language, leadKey),
      headline: say(language, headlineKey),
      elder: elder ? elderCard(language, elderTopic(headlineKey, evidence)) : null,
      simple: simpleLines(signs, language, elder ? 1 : 3),
      signs: signs.slice(0, elder ? 1 : 3).map((e) => ({ label: e.label, strength: e.strength, source: e.moduleLabel })),
      actions: actionsFor(context, language),
      disclaimer: say(language, "d_" + context),
      labels: {
        noticed: say(language, "noticed"),
        signs: say(language, "signs"),
        todo: say(language, "todo"),
        dismiss: say(language, "b_dismiss"),
        show: say(language, "b_show"),
        details: say(language, "b_details"),
        repeat: say(language, "note_repeat"),
        hidden: say(language, "note_hidden", { level: LEVEL_LABEL[category] }),
        partial: say(language, "note_partial"),
      },
    });
  }

  return { build, say, elderTopic, CONTEXTS, TIER_OF, HEADLINES, SIMPLE };
});

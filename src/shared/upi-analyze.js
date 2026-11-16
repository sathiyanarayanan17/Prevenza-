/*
 * Prevenza: offline UPI payment analyzer (Step 5).
 * Pure functions: no storage, no network, no browser APIs, nothing remembered between calls.
 *
 * analyzeUpi(input, { messageScan }) looks only at what the user typed or pasted into the form:
 *   upiId (optional), name (optional), amount, reason (optional), qrText (optional, decoded QR text pasted by hand).
 * It returns evidence in the format the central risk engine expects (the "payment" module). It never scores anything:
 * the score, category and advice come from risk-engine.js.
 *
 * It never sees a UPI PIN, an OTP, a screen or an app. It cannot stop or cancel a payment, and it never says
 * that a payment is fraud. An unfamiliar UPI ID is not a warning sign.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const rules = isNode ? require("./upi-rules.js") : root.Prevenza.upiRules;
  const api = factory(rules);
  if (isNode) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.upiAnalyze = api;
  }
})(typeof self !== "undefined" ? self : this, function (R) {
  "use strict";

  const VPA_RE = /^[a-z0-9][a-z0-9._-]{0,48}@[a-z][a-z0-9]{1,30}$/;
  const NOT_UPI_ID = "That does not look like a UPI ID. A UPI ID looks like name@bank.";

  // ---------------------------------------------------------------- small helpers
  function asciiDigits(s) {
    // Devanagari (U+0966-096F) and Tamil (U+0BE6-0BEF) digits to 0-9.
    return s.replace(/[\u0966-\u096f]/g, (c) => String(c.charCodeAt(0) - 0x0966)).replace(/[\u0be6-\u0bef]/g, (c) => String(c.charCodeAt(0) - 0x0be6));
  }

  /** "Rs. 5,000", "₹5000.50", "५०००", "5000/-" -> 5000. null when it is not a usable amount. */
  function parseAmount(raw) {
    if (typeof raw !== "string") return { ok: false, reason: "empty" };
    let s = asciiDigits(raw.normalize("NFKC")).toLowerCase().trim();
    if (s === "") return { ok: false, reason: "empty" };
    s = s.replace(/(?:₹|\brs\b\.?|\binr\b|rupees?|rupaye|रुपये|रुपए|ரூபாய்|\/-)/g, "").replace(/[\s,]/g, "");
    if (!/^\d+(?:\.\d{1,2})?$/.test(s)) return { ok: false, reason: "format" };
    const value = Number(s);
    if (!(value > 0)) return { ok: false, reason: "zero" };
    if (value >= R.AMOUNTS.impossible) return { ok: false, reason: "too-large" };
    return { ok: true, value };
  }

  function parseUpiId(raw) {
    if (typeof raw !== "string") return { ok: false };
    const s = raw.normalize("NFKC").trim().toLowerCase();
    if (!VPA_RE.test(s)) return { ok: false };
    const at = s.indexOf("@");
    return { ok: true, id: s, local: s.slice(0, at), handle: s.slice(at + 1) };
  }

  function editDistanceIsOne(a, b) {
    if (a === b) return false;
    if (Math.abs(a.length - b.length) > 1) return false;
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i += 1;
    if (a.length === b.length) return a.slice(i + 1) === b.slice(i + 1); // one letter changed
    const [longer, shorter] = a.length > b.length ? [a, b] : [b, a];
    return longer.slice(i + 1) === shorter.slice(i); // one letter added or removed
  }

  const LEET = { 0: "o", 1: "i", 3: "e", 5: "s", 4: "a" };
  function variants(token) {
    const out = new Set([token.replace(/\d+$/, "")]);
    if (/[a-z]/.test(token) && /\d/.test(token)) out.add(token.replace(/[0-9]/g, (d) => LEET[d] || d));
    return [...out].filter(Boolean);
  }

  /** Whole-word tokens of an ID or a name, plus neighbours joined together ("customer" + "care" = "customercare"). */
  function wordsOf(text) {
    const tokens = text.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
    const all = new Set();
    tokens.forEach((t, i) => {
      variants(t).forEach((v) => all.add(v));
      if (i + 1 < tokens.length) variants(tokens[i] + tokens[i + 1]).forEach((v) => all.add(v));
    });
    return [...all];
  }

  /** Which brand names and which "official-sounding" words appear in an ID or a name. */
  function nameSignals(text, handle) {
    const words = wordsOf(text);
    let brand = null;
    for (const b of R.BRANDS) {
      if (handle && b.handles.includes(handle)) continue; // a brand name in its own handle is normal
      const hit = words.some((w) => b.tokens.includes(w) || b.tokens.some((t) => w.startsWith(t) && R.SUPPORT_WORDS.includes(w.slice(t.length))));
      if (hit) {
        brand = b;
        break;
      }
    }
    const strong = words.some((w) => R.SUPPORT_WORDS.includes(w) && !R.WEAK_SUPPORT.includes(w));
    const weak = words.some((w) => R.WEAK_SUPPORT.includes(w));
    return { brand, support: strong || (weak && !!brand) };
  }

  function indicator(id, extra) {
    const def = R.INDICATORS[id];
    return Object.assign({ id, label: def.label, why: def.why, weight: def.weight, critical: false }, extra || {});
  }

  // ---------------------------------------------------------------- pasted QR text
  const QR_FIND = new RegExp("([a-z][a-z0-9+.-]{1,12}):\\/\\/(?:upi\\/)?(" + R.QR_KINDS.join("|") + ")\\?([^\\s]*)", "i");

  /**
   * Reads the text a QR scanner shows, such as upi://pay?pa=shop@ybl&pn=Shop&am=100.
   * Returns { ok:false, message } when it is not a UPI payment format.
   */
  function parseQrText(raw) {
    const text = typeof raw === "string" ? raw.normalize("NFKC").trim() : "";
    const m = QR_FIND.exec(text);
    if (!m || !R.QR_SCHEMES.includes(m[1].toLowerCase())) {
      const looksLikeLink = /^(?:https?:\/\/|www\.)/i.test(text);
      return {
        ok: false,
        message: looksLikeLink
          ? "This is a web address, not a UPI payment code. Use \"Check a link\" above for web addresses."
          : "Prevenza could not read this as a UPI payment code. Decoded UPI codes start with upi://pay? and look like upi://pay?pa=name@bank&pn=Name&am=100. Paste exactly what your QR scanner shows.",
      };
    }
    const params = new Map();
    for (const [k, v] of new URLSearchParams(m[3])) if (!params.has(k.toLowerCase())) params.set(k.toLowerCase(), v);
    const pa = parseUpiId(params.get("pa") || "");
    if (!pa.ok) return { ok: false, message: "This looks like a UPI code, but it has no readable recipient (the pa= part). It could not be analyzed." };
    const amount = params.get("am") ? parseAmount(params.get("am")) : null;
    const cu = (params.get("cu") || "").toUpperCase();
    return {
      ok: true,
      kind: m[2].toLowerCase(),
      recipient: pa,
      name: (params.get("pn") || "").slice(0, 100),
      amount: amount && amount.ok ? amount.value : null,
      amountUnreadable: !!(params.get("am") && !(amount && amount.ok)),
      note: (params.get("tn") || "").slice(0, 300),
      currencyOther: cu !== "" && cu !== "INR",
      rest: (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim(),
    };
  }

  // ---------------------------------------------------------------- the analysis
  function str(v) {
    return typeof v === "string" ? v : "";
  }

  /**
   * deps.messageScan: the Step 4 scanner (used to read the reason text). Without it the reason text is not checked.
   * Returns { ok:false, error, message, problems } when nothing could be analyzed, otherwise
   * { ok:true, indicators, problems, notes, qr, checked, linkText }.
   * linkText is the user's own text, for the caller to look for links. The caller must not keep it.
   */
  function analyzeUpi(input, deps) {
    try {
      if (input === null || typeof input !== "object" || Array.isArray(input)) {
        return { ok: false, error: "invalid", message: "That could not be read.", problems: [] };
      }
      const messageScan = deps && deps.messageScan;
      const fields = {
        upiId: str(input.upiId).trim(),
        name: str(input.name).trim(),
        amount: str(input.amount).trim(),
        reason: str(input.reason).trim(),
        qrText: str(input.qrText).trim(),
      };
      if (Object.values(fields).every((v) => v === "")) {
        return { ok: false, error: "empty", message: "Enter at least one detail to check, such as the UPI ID, the amount or the reason for the payment.", problems: [] };
      }

      const indicators = [];
      const problems = [];
      const notes = [];
      const checked = [];
      const textParts = [];
      let reasonText = "";

      // QR text first: it can supply details the user left empty.
      let qr = null;
      if (fields.qrText) {
        qr = parseQrText(fields.qrText);
        if (!qr.ok) problems.push({ field: "qrText", message: qr.message });
        else {
          checked.push("Pasted QR text");
          if (qr.kind === "collect") indicators.push(indicator("upi_qr_collect_request"));
          if (qr.kind === "mandate") indicators.push(indicator("upi_qr_autopay_mandate"));
          if (qr.currencyOther) notes.push("The code names a currency other than rupees (INR). That is unusual for a UPI payment.");
          if (qr.amountUnreadable) problems.push({ field: "qrText", message: "The amount in the code could not be read." });
          if (qr.note) reasonText += qr.note + "\n";
          if (qr.rest) {
            reasonText += qr.rest + "\n";
            textParts.push(qr.rest);
          }
        }
      }

      // UPI ID
      let idInfo = null;
      if (fields.upiId) {
        idInfo = parseUpiId(fields.upiId);
        if (!idInfo.ok) problems.push({ field: "upiId", message: NOT_UPI_ID });
      }
      if (qr && qr.ok) {
        if (idInfo && idInfo.ok && qr.recipient.id !== idInfo.id) indicators.push(indicator("upi_qr_recipient_differs"));
        if (!idInfo || !idInfo.ok) {
          if (!fields.upiId) notes.push("The recipient was taken from the pasted code.");
          idInfo = qr.recipient;
        }
      }
      if (idInfo && idInfo.ok) {
        checked.push("Recipient UPI ID");
        const s = nameSignals(idInfo.local, idInfo.handle);
        if (s.brand) indicators.push(indicator("upi_id_bank_name"));
        if (s.support) indicators.push(indicator("upi_id_support_word"));
        const lookalike = idInfo.handle.length >= R.LIMITS.handleLookalikeMinLength && !R.HANDLES.includes(idInfo.handle) && R.HANDLES.some((h) => h.length >= R.LIMITS.handleLookalikeMinLength && editDistanceIsOne(h, idInfo.handle));
        if (lookalike) indicators.push(indicator("upi_handle_lookalike"));
        else if (!R.HANDLES.includes(idInfo.handle)) {
          notes.push("The part after the @ is not on Prevenza's short list of common names. That is common and is not a warning sign by itself.");
        }
      }

      // Recipient name
      const nameText = fields.name || (qr && qr.ok ? qr.name : "");
      if (nameText) {
        checked.push("Recipient name");
        const s = nameSignals(nameText, idInfo && idInfo.ok ? idInfo.handle : "");
        if (s.brand || s.support) indicators.push(indicator("upi_name_official_claim"));
      }

      // Amount
      let amountValue = null;
      if (fields.amount) {
        const a = parseAmount(fields.amount);
        if (a.ok) amountValue = a.value;
        else {
          const msg = a.reason === "too-large" ? "That amount is too large to be a real payment, so it was not used." : a.reason === "zero" ? "The amount must be more than zero." : "The amount could not be read. Type digits only, for example 500 or 1,250.50.";
          problems.push({ field: "amount", message: msg });
        }
      }
      if (qr && qr.ok && qr.amount !== null) {
        if (amountValue !== null && Math.abs(qr.amount - amountValue) > 0.005) indicators.push(indicator("upi_qr_amount_differs"));
        if (amountValue === null && !fields.amount) {
          amountValue = qr.amount;
          notes.push("The amount was taken from the pasted code.");
        }
      }
      if (amountValue !== null) {
        checked.push("Amount");
        if (amountValue >= R.AMOUNTS.unusual) indicators.push(indicator("upi_amount_unusual"));
        else if (amountValue >= R.AMOUNTS.attention) indicators.push(indicator("upi_amount_large"));
      }

      // Reason or request message, read with the Step 4 scanner in payment mode (adds refund, KYC-fee, parcel-fee,
      // customer-care and pay-to-receive wording, and leaves out "send money" which every payment contains).
      if (fields.reason) reasonText = fields.reason + "\n" + reasonText;
      if (fields.reason) textParts.push(fields.reason);
      if (reasonText.trim() && messageScan) {
        const scanned = messageScan.scanMessage(reasonText.trim(), { payment: true });
        if (scanned.ok) {
          checked.push(fields.reason ? "Reason or request message" : "Note inside the code");
          for (const i of scanned.indicators) indicators.push(i);
        }
      }

      if (checked.length === 0) {
        return { ok: false, error: "unreadable", message: "None of the details could be read, so nothing was checked. See the notes below.", problems };
      }
      return { ok: true, indicators, problems, notes, qr: qr && qr.ok ? summariseQr(qr) : qr, checked, linkText: textParts.join("\n") };
    } catch (e) {
      return { ok: false, error: "internal", message: "This payment could not be checked.", problems: [] };
    }
  }

  function summariseQr(qr) {
    return { ok: true, kind: qr.kind, recipient: qr.recipient.id, name: qr.name, amount: qr.amount, hasNote: qr.note !== "" };
  }

  // ---------------------------------------------------------------- Holdy's warning for a UPI result
  // Shown only when the risk engine says MEDIUM or higher, and the headline follows the evidence that was actually found.
  const HEADLINES = Object.freeze([
    { when: /otp|pin|credential/, headline: "Never share your UPI PIN or OTP with anyone.", detail: "A PIN or OTP is only for you. Nobody who is genuinely helping you will ask for it." },
    { when: /receive_money|pay_to_receive|collect|refund/, headline: "Someone asking you to pay to receive money? Be careful.", detail: "You never need to pay, scan a code, enter a PIN or approve a request in order to receive money." },
    { when: /safe_account|custody/, headline: "There is no such thing as a safe account for your money.", detail: "No bank or office asks you to move money to a safe account." },
    { when: /kyc|parcel|customer_care/, headline: "Fees for KYC, parcels or support are a common trick.", detail: "Check with the real company, using a website or number you already trust." },
  ]);

  const ACTIONS = Object.freeze([
    "Review the payment details above.",
    "Cancel and check with the recipient, using a phone number you already know.",
    "Ask a trusted family member or friend.",
    "Continue only after you understand the warning and have checked who you are paying.",
  ]);

  const CANNOT_STOP = "Prevenza cannot stop or cancel a payment in your UPI app. Only you can decide whether to pay.";

  /** Returns null when no warning is called for (LOW, inconclusive or no result). */
  function holdyWarning(assessment) {
    if (!assessment || !["MEDIUM", "HIGH", "CRITICAL"].includes(assessment.category) || !Array.isArray(assessment.evidence)) return null;
    const ids = assessment.evidence.filter((e) => e.points > 0).map((e) => e.id);
    const hit = HEADLINES.find((h) => ids.some((id) => h.when.test(id)));
    const lead = assessment.category === "CRITICAL" ? "Stop and check before you pay." : "Hold on!";
    return {
      level: assessment.category,
      lead,
      headline: hit ? hit.headline : "Check the recipient before sending money.",
      detail: hit ? hit.detail : "Some details of this payment look unusual. Make sure you know who you are paying and why.",
      actions: ACTIONS.slice(),
      disclaimer: CANNOT_STOP,
    };
  }

  return { analyzeUpi, holdyWarning, parseAmount, parseUpiId, parseQrText, CANNOT_STOP };
});

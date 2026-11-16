/*
 * Prevenza: UPI payment analyzer on the dashboard (Step 5).
 * The user types or pastes payment details. They go to the background worker, are analysed in memory and are never stored.
 * There is no field for a UPI PIN or an OTP, and nothing here reads a UPI app or a screen.
 */
(function () {
  "use strict";
  const H = self.Prevenza;
  const MSG = H.MSG;
  const $ = (id) => document.getElementById(id);
  const result = $("upi-result");
  const FIELDS = { upiId: $("upi-id"), name: $("upi-name"), amount: $("upi-amount"), reason: $("upi-reason"), qrText: $("upi-qr") };

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  const STRENGTH = {
    critical: { word: "Critical sign", cls: "sev-high" },
    strong: { word: "Strong sign", cls: "sev-high" },
    moderate: { word: "Warning sign", cls: "sev-medium" },
    minor: { word: "Minor sign", cls: "sev-low" },
  };
  const KIND_WORDS = { pay: "A payment to the recipient", collect: "A request that takes money from you when you approve it", mandate: "A repeating automatic payment" };

  function list(className, lines) {
    const ul = el("ul", className);
    lines.forEach((line) => ul.appendChild(el("li", null, line)));
    return ul;
  }

  function render(reply) {
    result.textContent = "";
    if (!reply.ok) {
      result.appendChild(el("p", "problem", "Prevenza could not check that right now. Please try again."));
      return;
    }
    if (reply.skipped === "protection-off") {
      result.appendChild(el("p", "muted", "Protection is off, so payments are not checked. Turn it on in Settings."));
      return;
    }
    const r = reply.result;
    if (!r.ok) {
      result.appendChild(el("p", "problem", r.message));
      if (r.problems && r.problems.length) result.appendChild(list("phrases", r.problems.map((p) => p.message)));
      return;
    }
    const a = r.assessment;

    const verdict = el("div", "verdict");
    const mascot = el("span");
    mascot.setAttribute("data-mascot", "40");
    mascot.setAttribute("aria-hidden", "true");
    const pill = el("span", "pill");
    H.ui.setCategoryPill(pill, a.category);
    verdict.append(mascot, pill);
    if (typeof a.score === "number") verdict.appendChild(el("span", "score", "Warning level " + a.score + " of 100"));
    result.appendChild(verdict);
    result.appendChild(el("p", "muted small", a.scoreMeaning + " Prevenza cannot tell whether a payment is a scam. It can only point out signs worth checking."));

    // Prevy's card (Step 7, shared with every checker). For UPI, "Review" returns you to the form; it never acts on a payment.
    const holdySlot = el("div", "holdy-slot");
    result.appendChild(holdySlot);
    H.holdyCard.render(holdySlot, a, {
      context: "upi",
      onReview: () => {
        $("upi-check").scrollIntoView({ block: "start" });
        FIELDS.upiId.focus();
      },
    });

    if (r.problems.length) {
      result.appendChild(el("h3", null, "Details that could not be used"));
      result.appendChild(list("phrases", r.problems.map((p) => p.message)));
    }

    if (r.qr) {
      result.appendChild(el("h3", null, "What the pasted code contains"));
      const facts = el("dl", "qr-facts");
      const add = (k, v) => facts.append(el("dt", null, k), el("dd", null, v));
      add("Type", KIND_WORDS[r.qr.kind] || r.qr.kind);
      add("Recipient", r.qr.recipient);
      if (r.qr.name) add("Name in the code", r.qr.name);
      add("Amount", r.qr.amount === null ? "Not stated in the code" : "\u20B9 " + r.qr.amount);
      add("Note in the code", r.qr.hasNote ? "Yes (it was checked too)" : "None");
      result.appendChild(facts);
    }

    result.appendChild(el("h3", null, "Why this result"));
    if (a.reasons.length === 0) {
      result.appendChild(el("p", "muted", "No strong warning signs were found in the details you gave. " + a.confidence.note));
    } else {
      const ul = el("ul", "reasons");
      a.reasons.forEach((reason) => {
        const li = document.createElement("li");
        const strength = STRENGTH[reason.strength] || { word: "Note", cls: "sev-info" };
        const row = el("div", "tag-row");
        row.append(el("span", "sev " + strength.cls, strength.word), el("span", "chip", reason.moduleLabel));
        li.append(row, el("strong", null, reason.text), el("p", "muted small", reason.detail));
        ul.appendChild(li);
      });
      result.appendChild(ul);
    }
    a.conflicts.forEach((c) => result.appendChild(el("p", "muted small note", c)));
    if (r.notes.length) result.appendChild(list("phrases", r.notes));

    result.appendChild(el("h3", null, "What to do"));
    result.appendChild(list("actions-list", a.actions));
    result.appendChild(el("p", "muted small", "Always compare the name your UPI app shows for the recipient with the person or company you mean to pay."));

    const links = r.linksChecked > 0 ? " and " + r.linksChecked + (r.linksChecked === 1 ? " link" : " links") + " inside your text" : "";
    result.appendChild(el("p", "muted small", "Checked: " + r.checked.join(", ") + links + ". Confidence: " + a.confidence.level.toLowerCase() + ". " + a.confidence.note));
    if (!r.warning) result.appendChild(el("p", "muted small", r.cannotStop));
    H.ui.placeMascots(result);
  }

  $("upi-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const payload = {};
    Object.keys(FIELDS).forEach((k) => {
      payload[k] = FIELDS[k].value;
    });
    render(await H.messaging.send({ type: MSG.ANALYZE_UPI, payload }));
  });

  $("upi-clear").addEventListener("click", () => {
    Object.values(FIELDS).forEach((f) => {
      f.value = "";
    });
    result.textContent = "";
    FIELDS.upiId.focus();
  });
})();

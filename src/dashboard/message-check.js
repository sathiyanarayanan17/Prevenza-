/*
 * Prevenza: message checker on the dashboard (Step 4).
 * The user pastes text. It goes to the background worker, is analysed in memory and is never stored.
 * The reply holds character positions and rule wording, never a copy of the message, so this page cuts the
 * highlights out of the text the user already has in the box.
 */
(function () {
  "use strict";
  const H = self.Prevenza;
  const MSG = H.MSG;
  const $ = (id) => document.getElementById(id);

  const input = $("msg-input");
  const select = $("msg-language");
  const result = $("msg-result");
  const maxChars = H.MESSAGE_LIMITS.maxAnalysed;
  input.maxLength = maxChars;

  H.SCAN_LANGUAGES.forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang.id;
    option.textContent = lang.label;
    select.appendChild(option);
  });

  function updateCount() {
    $("msg-count").textContent = input.value.length + " of " + maxChars + " characters";
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // The risk engine describes each reason's strength in words. These are the words shown to people.
  const STRENGTH = {
    critical: { word: "Critical sign", cls: "sev-high" },
    strong: { word: "Strong sign", cls: "sev-high" },
    moderate: { word: "Warning sign", cls: "sev-medium" },
    minor: { word: "Minor sign", cls: "sev-low" },
  };

  /** The pasted text with the flagged phrases marked: bold, underlined and tinted, with a hidden label for screen readers. */
  function renderMarked(container, text, highlights) {
    container.textContent = "";
    const phrases = [];
    let pos = 0;
    highlights.forEach((h) => {
      if (!Number.isInteger(h.start) || !Number.isInteger(h.end) || h.start < pos || h.end > text.length || h.end <= h.start) return;
      if (h.start > pos) container.appendChild(document.createTextNode(text.slice(pos, h.start)));
      const phrase = text.slice(h.start, h.end);
      const mark = document.createElement("mark");
      mark.className = "hit";
      mark.appendChild(el("span", "visually-hidden", "Flagged phrase: "));
      mark.appendChild(document.createTextNode(phrase));
      container.appendChild(mark);
      if (!phrases.includes(phrase) && phrases.length < 8) phrases.push(phrase.length > 90 ? phrase.slice(0, 90) + "..." : phrase);
      pos = h.end;
    });
    if (pos < text.length) container.appendChild(document.createTextNode(text.slice(pos)));
    return phrases;
  }

  function showProblem(text) {
    result.textContent = "";
    result.appendChild(el("p", "problem", text));
  }

  function render(reply, text) {
    result.textContent = "";
    if (!reply.ok) return showProblem("Prevenza could not check that right now. Please try again.");
    if (reply.skipped === "protection-off") {
      result.appendChild(el("p", "muted", "Protection is off, so messages are not checked. Turn it on in Settings."));
      return;
    }
    const r = reply.result;
    if (!r.ok) return showProblem(r.message || "That could not be checked.");

    const a = r.assessment;
    const analysed = text.slice(0, r.analysedLength);

    // Verdict: the Prevy mascot, a label with a shape, and the score with its meaning.
    const verdict = el("div", "verdict");
    const mascot = el("span");
    mascot.setAttribute("data-mascot", "40");
    mascot.setAttribute("aria-hidden", "true");
    const pill = el("span", "pill");
    H.ui.setCategoryPill(pill, a.category);
    verdict.append(mascot, pill);
    if (typeof a.score === "number") verdict.appendChild(el("span", "score", "Warning level " + a.score + " of 100"));
    result.appendChild(verdict);
    result.appendChild(el("p", "muted small", a.scoreMeaning));
    const holdySlot = el("div", "holdy-slot");
    result.appendChild(holdySlot);
    let whyHeading = null;

    result.appendChild(
      el("p", null, r.primaryCategory ? "Looks like: " + r.primaryCategory.label : "No specific kind of scam stood out in this message.")
    );
    if (r.otherCategories.length > 0) {
      result.appendChild(el("p", "muted small", "Also: " + r.otherCategories.map((c) => c.label).join(", ") + "."));
    }

    // Language line. Always worded as a guess.
    const lang = r.language;
    let langLine = "Language: " + lang.label + " (" + lang.confidence + " confidence, a best guess)";
    if (lang.mixed) langLine += ". The message mixes languages or alphabets";
    result.appendChild(el("p", "muted small", langLine + "."));
    if (r.languageNote) result.appendChild(el("p", "muted small", r.languageNote));
    if (r.truncated) result.appendChild(el("p", "muted small", "The message was long. Only the first " + r.analysedLength + " characters were checked."));
    if (r.shortText) result.appendChild(el("p", "muted small", "This message is very short, so there was little to check."));

    // The user's own words, with the suspicious phrases marked.
    if (r.highlights.length > 0) {
      result.appendChild(el("h3", null, "Your message, with suspicious phrases marked"));
      const marked = el("p", "msg-text");
      const phrases = renderMarked(marked, analysed, r.highlights);
      result.appendChild(marked);
      if (phrases.length > 0) {
        result.appendChild(el("p", "muted small", "Phrases that raised concern:"));
        const list = el("ul", "phrases");
        phrases.forEach((p) => list.appendChild(el("li", null, p)));
        result.appendChild(list);
      }
    }

    // Why. Every line comes from a sign that was actually found.
    whyHeading = el("h3", null, "Why this result");
    result.appendChild(whyHeading);
    if (a.reasons.length === 0) {
      result.appendChild(el("p", "muted", "No strong warning signs were found in what was checked. " + a.confidence.note));
    } else {
      const list = el("ul", "reasons");
      a.reasons.forEach((reason) => {
        const li = document.createElement("li");
        const strength = STRENGTH[reason.strength] || { word: "Note", cls: "sev-info" };
        const row = el("div", "tag-row");
        row.append(el("span", "sev " + strength.cls, strength.word), el("span", "chip", reason.moduleLabel));
        li.append(row, el("strong", null, reason.text), el("p", "muted small", reason.detail));
        list.appendChild(li);
      });
      result.appendChild(list);
    }
    a.conflicts.forEach((c) => result.appendChild(el("p", "muted small note", c)));

    // What to do.
    result.appendChild(el("h3", null, "What to do"));
    const actions = el("ul", "actions-list");
    a.actions.forEach((line) => actions.appendChild(el("li", null, line)));
    result.appendChild(actions);

    const checked = "Checked: message text" + (r.linksChecked > 0 ? " and " + r.linksChecked + (r.linksChecked === 1 ? " link" : " links") + " inside it" : "") + ".";
    result.appendChild(el("p", "muted small", checked + " Confidence: " + a.confidence.level.toLowerCase() + ". " + a.confidence.note));

    H.holdyCard.render(holdySlot, a, { context: "message", reviewTarget: () => whyHeading });
    H.ui.placeMascots(result);
  }

  $("msg-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const text = input.value;
    const reply = await H.messaging.send({ type: MSG.SCAN_MESSAGE, payload: { text, language: select.value } });
    render(reply, text);
  });

  $("msg-clear").addEventListener("click", () => {
    input.value = "";
    result.textContent = "";
    updateCount();
    input.focus();
  });

  input.addEventListener("input", updateCount);
  updateCount();
  if (location.hash === "#message-check") input.focus();
})();

/*
 * Prevenza: screenshot checker on the dashboard (Step 6).
 * The user chooses an image file. Its text is read on this device (ocr-runner.js), shown to the user, and sent to the
 * background worker as plain text for analysis. The image never leaves this page, and nothing is saved.
 *
 * What is kept, and for how long
 *   - the image bytes: only until the reading finishes (or fails), then dropped
 *   - the preview picture and the text box: only on this page, until "Remove image" or "Clear all", or the page is closed
 *   - nothing is written to storage, a cache or a file
 */
(function () {
  "use strict";
  const H = self.Prevenza;
  const MSG = H.MSG;
  const S = H.screenshot;
  const $ = (id) => document.getElementById(id);

  const el = {
    file: $("shot-file"),
    fileName: $("shot-file-name"),
    language: $("shot-language"),
    preview: $("shot-preview"),
    img: $("shot-img"),
    analyze: $("shot-analyze"),
    remove: $("shot-remove"),
    clear: $("shot-clear"),
    progressWrap: $("shot-progress-wrap"),
    progress: $("shot-progress"),
    status: $("shot-status"),
    problem: $("shot-problem"),
    textWrap: $("shot-text-wrap"),
    text: $("shot-text"),
    recheck: $("shot-recheck"),
    result: $("shot-result"),
  };
  const NO_FILE = "No image chosen. PNG or JPEG, up to 8 MB.";
  let bytes = null; // the chosen image, held only until it has been read
  let busy = false;

  S.OCR_LANGUAGES.forEach((lang) => {
    const option = document.createElement("option");
    option.value = lang.id;
    option.textContent = lang.label;
    el.language.appendChild(option);
  });

  function node(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function showProblem(text) {
    el.problem.textContent = text;
    el.problem.hidden = !text;
  }

  function setBusy(on) {
    busy = on;
    el.analyze.disabled = on || !bytes;
    el.remove.disabled = on || (!bytes && el.preview.hidden);
    el.recheck.disabled = on;
    el.file.disabled = on;
  }

  function dropImage() {
    bytes = null;
    el.img.removeAttribute("src");
    el.preview.hidden = true;
    el.file.value = "";
    el.fileName.textContent = NO_FILE;
    el.analyze.disabled = true;
    el.remove.disabled = true;
  }

  function resetResults() {
    el.result.textContent = "";
    el.text.value = "";
    el.textWrap.hidden = true;
    el.progressWrap.hidden = true;
    showProblem("");
  }

  function clearAll() {
    dropImage();
    resetResults();
    setBusy(false);
  }

  // ---------------------------------------------------------------- choosing an image
  el.file.addEventListener("change", async () => {
    resetResults();
    const file = el.file.files && el.file.files[0];
    if (!file) {
      dropImage();
      return;
    }
    const reject = (message) => {
      dropImage();
      showProblem(message);
    };
    const bySize = S.validateImage({ size: file.size });
    if (!bySize.ok) return reject(bySize.message);
    let head;
    try {
      head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    } catch (e) {
      return reject("That file could not be read. Choose another screenshot.");
    }
    const byType = S.validateImage({ size: file.size }, head);
    if (!byType.ok) return reject(byType.message);
    try {
      bytes = new Uint8Array(await file.arrayBuffer());
      const dataUrl = await new Promise((resolve, reject2) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject2(new Error("preview"));
        reader.readAsDataURL(file);
      });
      el.img.src = dataUrl;
    } catch (e) {
      return reject("That file could not be read. Choose another screenshot.");
    }
    el.preview.hidden = false;
    el.fileName.textContent = "Image chosen (" + byType.kind.toUpperCase() + ", " + (file.size / 1048576).toFixed(1) + " MB). It stays on this page.";
    setBusy(false);
  });

  el.remove.addEventListener("click", () => {
    dropImage();
    resetResults();
    setBusy(false);
  });
  el.clear.addEventListener("click", clearAll);

  // ---------------------------------------------------------------- reading and checking
  function onProgress(p) {
    el.progress.value = Math.max(0, Math.min(100, Math.round(p.percent)));
    el.status.textContent = p.text + " (" + el.progress.value + "%)";
  }

  async function sendText(text, confidence) {
    const choice = S.OCR_LANGUAGES.find((l) => l.id === el.language.value) || S.OCR_LANGUAGES[0];
    const reply = await H.messaging.send({ type: MSG.ANALYZE_SCREENSHOT, payload: { text, language: choice.scan, confidence } }, 8000);
    render(reply, text);
  }

  el.analyze.addEventListener("click", async () => {
    if (!bytes || busy) return;
    const choice = S.OCR_LANGUAGES.find((l) => l.id === el.language.value) || S.OCR_LANGUAGES[0];
    resetResults();
    setBusy(true);
    el.progressWrap.hidden = false;
    onProgress({ percent: 1, text: "Getting ready" });
    const image = bytes;
    let read = null;
    try {
      read = await H.ocr.run(image, choice.codes.slice(), onProgress);
    } catch (e) {
      read = null;
    }
    // The reading is over, so the image data is released. The preview picture stays until the user removes it.
    bytes = null;
    el.progressWrap.hidden = true;
    if (!read) {
      showProblem("Prevenza could not read this image. That does not mean it is safe. Try another screenshot, or a clearer one.");
      el.result.appendChild(node("p", "muted small", "Nothing was checked. Press \"Remove image\" and choose another screenshot."));
      setBusy(false);
      return;
    }
    const text = read.text.trim().slice(0, S.LIMITS.maxTextChars);
    el.text.value = text;
    el.textWrap.hidden = false;
    await sendText(text, read.confidence);
    setBusy(false);
    el.analyze.disabled = true; // the image data was released: choose the file again to read it with another language
  });

  el.recheck.addEventListener("click", async () => {
    if (busy) return;
    showProblem("");
    setBusy(true);
    await sendText(el.text.value, null);
    setBusy(false);
    el.analyze.disabled = !bytes;
  });

  // ---------------------------------------------------------------- showing the result
  const STRENGTH = {
    critical: { word: "Critical sign", cls: "sev-high" },
    strong: { word: "Strong sign", cls: "sev-high" },
    moderate: { word: "Warning sign", cls: "sev-medium" },
    minor: { word: "Minor sign", cls: "sev-low" },
  };

  function list(className, lines) {
    const ul = node("ul", className);
    lines.forEach((line) => ul.appendChild(node("li", null, line)));
    return ul;
  }

  const RECEIPT_PARTS = { successMessage: "a success message", amount: "an amount", recipient: "a recipient", reference: "a reference number" };

  function render(reply, text) {
    const out = el.result;
    out.textContent = "";
    if (!reply.ok) {
      out.appendChild(node("p", "problem", "Prevenza could not check that right now. Please try again."));
      return;
    }
    if (reply.skipped === "protection-off") {
      out.appendChild(node("p", "muted", "Protection is off, so screenshots are not checked. Turn it on in Settings."));
      return;
    }
    const r = reply.result;
    if (!r.ok) {
      out.appendChild(node("p", "problem", r.message || "That could not be checked."));
      return;
    }
    const a = r.assessment;

    const verdict = node("div", "verdict");
    const mascot = node("span");
    mascot.setAttribute("data-mascot", "40");
    mascot.setAttribute("aria-hidden", "true");
    const pill = node("span", "pill");
    H.ui.setCategoryPill(pill, a.category);
    verdict.append(mascot, pill);
    if (typeof a.score === "number") verdict.appendChild(node("span", "score", "Warning level " + a.score + " of 100"));
    out.appendChild(verdict);
    if (typeof a.score === "number") out.appendChild(node("p", "muted small", a.scoreMeaning));

    if (r.quality.message) out.appendChild(node("p", r.quality.level === "none" || r.quality.level === "poor" ? "problem" : "muted small", r.quality.message));
    // Prevy's card or note (Step 7). For an unreadable image it explains that nothing could be decided.
    const holdySlot = node("div", "holdy-slot");
    out.appendChild(holdySlot);
    let whyHeading = null;
    H.holdyCard.render(holdySlot, a, { context: "screenshot", reviewTarget: () => whyHeading || el.text });
    if (!r.readable || a.score === null) {
      out.appendChild(node("p", "muted", a.recommendedAction));
      out.appendChild(node("p", "muted small", "Nothing was marked safe. Try another image, or type the words from the screenshot into \"Check a message\" above."));
      H.ui.placeMascots(out);
      return;
    }

    if (r.receiptWarning) {
      const box = node("div", "notice");
      box.setAttribute("role", "note");
      box.append(node("strong", null, r.receiptWarning.text), node("p", "small", r.receiptWarning.caveat));
      const seen = Object.keys(RECEIPT_PARTS).filter((k) => r.receipt.details[k]).map((k) => RECEIPT_PARTS[k]);
      if (seen.length) box.appendChild(node("p", "muted small", "Seen in the text: " + seen.join(", ") + ". None of it was verified."));
      out.appendChild(box);
    }

    out.appendChild(node("p", null, r.primaryCategory ? "Looks like: " + r.primaryCategory.label : "No specific kind of scam stood out in this text."));
    if (r.otherCategories.length > 0) out.appendChild(node("p", "muted small", "Also: " + r.otherCategories.map((c) => c.label).join(", ") + "."));
    out.appendChild(node("p", "muted small", "Language of the text: " + r.language.label + " (a best guess)."));
    if (r.truncated) out.appendChild(node("p", "muted small", "The text was long. Only the first " + r.analysedLength + " characters were checked."));

    if (r.highlights.length > 0) {
      out.appendChild(node("h3", null, "The text, with suspicious phrases marked"));
      const marked = node("p", "msg-text");
      const phrases = H.ui.renderMarked(marked, text.slice(0, r.analysedLength), r.highlights);
      out.appendChild(marked);
      if (phrases.length) {
        out.appendChild(node("p", "muted small", "Phrases that raised concern:"));
        out.appendChild(list("phrases", phrases));
      }
    }

    whyHeading = node("h3", null, "Why this result");
    out.appendChild(whyHeading);
    if (a.reasons.length === 0) {
      out.appendChild(node("p", "muted", "No strong warning signs were found in the text that was read. " + a.confidence.note));
    } else {
      const ul = node("ul", "reasons");
      a.reasons.forEach((reason) => {
        const li = document.createElement("li");
        const strength = STRENGTH[reason.strength] || { word: "Note", cls: "sev-info" };
        const row = node("div", "tag-row");
        row.append(node("span", "sev " + strength.cls, strength.word), node("span", "chip", reason.moduleLabel));
        li.append(row, node("strong", null, reason.text), node("p", "muted small", reason.detail));
        ul.appendChild(li);
      });
      out.appendChild(ul);
    }
    a.conflicts.forEach((c) => out.appendChild(node("p", "muted small note", c)));

    out.appendChild(node("h3", null, "What to do"));
    out.appendChild(list("actions-list", a.actions));
    const links = r.linksChecked > 0 ? " and " + r.linksChecked + (r.linksChecked === 1 ? " link" : " links") + " inside it" : "";
    out.appendChild(node("p", "muted small", "Checked: the text read from the screenshot" + links + ". Confidence: " + a.confidence.level.toLowerCase() + ". " + a.confidence.note));
    H.ui.placeMascots(out);
  }

  setBusy(false);
})();

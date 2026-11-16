/*
 * Prevenza: small UI helpers shared by the popup, settings and dashboard pages.
 * Only CSSOM and DOM APIs are used (no inline styles, no innerHTML), so the page CSP can stay strict.
 */
(function () {
  "use strict";
  const H = (self.Prevenza = self.Prevenza || {});

  /** Replace every <span data-mascot="48"></span> with Prevy. */
  function placeMascots(root) {
    (root || document).querySelectorAll("[data-mascot]").forEach((slot) => {
      if (slot.firstChild) return;
      const size = parseInt(slot.getAttribute("data-mascot"), 10) || 48;
      slot.appendChild(H.mascotElement(document, size));
    });
  }

  /** Apply user preferences to the page (elder mode makes everything larger; the language swaps the labelled text). */
  function applyPrefs(settings) {
    const html = document.documentElement;
    html.setAttribute("data-elder", settings && settings.elderMode ? "true" : "false");
    html.lang = (settings && settings.language) || "en";
    if (H.i18n) H.i18n.apply(document, html.lang);
  }

  /** Interface label in the page's language (English when the language or the key is unknown). */
  function label(key) {
    return H.i18n ? H.i18n.t(document.documentElement.lang, key) : "";
  }

  let toastTimer = null;
  function toast(text, kind) {
    let el = document.getElementById("toast");
    if (!el) {
      el = document.createElement("div");
      el.id = "toast";
      el.className = "toast";
      el.setAttribute("role", "status");
      document.body.appendChild(el);
    }
    el.textContent = text;
    el.setAttribute("data-kind", kind || "ok");
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => el.classList.remove("show"), 2600);
  }

  function formatDate(iso) {
    if (!iso) return "Never";
    const d = new Date(iso);
    return Number.isNaN(d.getTime()) ? "Never" : d.toLocaleString();
  }

  /** Set a risk pill. level is null (not scanned) or "low" | "medium" | "high". Label and shape always show, never colour alone. */
  function setRiskPill(el, level) {
    ["pill-unknown", "pill-low", "pill-caution", "pill-danger"].forEach((c) => el.classList.remove(c));
    const risk = level && H.urlIntel ? H.urlIntel.URL_RISK[level] : null;
    if (!risk) {
      el.classList.add("pill-unknown");
      el.textContent = label("pill_none") || "Not scanned yet";
      return;
    }
    el.classList.add("pill-" + risk.pill);
    el.textContent = label("pill_" + level) || risk.label;
  }

  // The central risk engine uses four categories. Each has a text label and its own shape (see theme.css).
  const CATEGORY_PILLS = {
    LOW: { cls: "pill-low", label: "Low risk", key: "pill_low" },
    MEDIUM: { cls: "pill-caution", label: "Medium risk", key: "pill_medium" },
    HIGH: { cls: "pill-danger", label: "High risk", key: "pill_high" },
    CRITICAL: { cls: "pill-critical", label: "Critical risk", key: "pill_critical" },
    INCONCLUSIVE: { cls: "pill-unknown", label: "Inconclusive", key: "pill_inconclusive" },
    NOT_SCANNED: { cls: "pill-unknown", label: "Not scanned yet", key: "pill_none" },
  };

  /** Set a pill from a risk-engine category. Unknown values show "Not scanned yet". */
  function setCategoryPill(el, category) {
    ["pill-unknown", "pill-low", "pill-caution", "pill-danger", "pill-critical"].forEach((c) => el.classList.remove(c));
    const pill = CATEGORY_PILLS[category] || CATEGORY_PILLS.NOT_SCANNED;
    el.classList.add(pill.cls);
    el.textContent = label(pill.key) || pill.label;
  }

  const SEVERITY_WORDS = { high: "Strong sign", medium: "Warning sign", low: "Minor sign", info: "Note" };

  /** Fill a <ul> with the reasons from an analysis, in plain language. Text only, never HTML. */
  function renderIndicators(listEl, indicators, max) {
    listEl.textContent = "";
    const items = Array.isArray(indicators) ? indicators : [];
    const shown = typeof max === "number" ? items.slice(0, max) : items;
    shown.forEach((ind) => {
      const li = document.createElement("li");
      const tag = document.createElement("span");
      tag.className = "sev sev-" + (SEVERITY_WORDS[ind.severity] ? ind.severity : "info");
      tag.textContent = SEVERITY_WORDS[ind.severity] || "Note";
      const title = document.createElement("strong");
      title.textContent = ind.label;
      const why = document.createElement("p");
      why.className = "muted small";
      why.textContent = ind.why;
      li.append(tag, title, why);
      listEl.appendChild(li);
    });
    if (shown.length < items.length) {
      const more = document.createElement("li");
      more.className = "muted small";
      more.textContent = "and " + (items.length - shown.length) + " more.";
      listEl.appendChild(more);
    }
  }

  /**
   * Writes text into a container with the flagged phrases marked: bold, underlined and tinted, plus a hidden label for
   * screen readers, so the mark never depends on colour alone. highlights are { start, end } positions in text.
   * Text and DOM nodes only, never HTML. Returns the distinct phrases that were marked (at most 8), shortened.
   */
  function renderMarked(container, text, highlights) {
    container.textContent = "";
    const phrases = [];
    let pos = 0;
    (Array.isArray(highlights) ? highlights : []).forEach((h) => {
      if (!h || !Number.isInteger(h.start) || !Number.isInteger(h.end) || h.start < pos || h.end > text.length || h.end <= h.start) return;
      if (h.start > pos) container.appendChild(document.createTextNode(text.slice(pos, h.start)));
      const phrase = text.slice(h.start, h.end);
      const mark = document.createElement("mark");
      mark.className = "hit";
      const hidden = document.createElement("span");
      hidden.className = "visually-hidden";
      hidden.textContent = "Flagged phrase: ";
      mark.appendChild(hidden);
      mark.appendChild(document.createTextNode(phrase));
      container.appendChild(mark);
      if (!phrases.includes(phrase) && phrases.length < 8) phrases.push(phrase.length > 90 ? phrase.slice(0, 90) + "..." : phrase);
      pos = h.end;
    });
    if (pos < text.length) container.appendChild(document.createTextNode(text.slice(pos)));
    return phrases;
  }

  H.ui = { placeMascots, applyPrefs, label, toast, formatDate, setRiskPill, setCategoryPill, renderIndicators, renderMarked };
})();

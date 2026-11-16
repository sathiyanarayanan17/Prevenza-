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

  /** Apply user preferences to the page (elder mode makes everything larger). */
  function applyPrefs(settings) {
    const html = document.documentElement;
    html.setAttribute("data-elder", settings && settings.elderMode ? "true" : "false");
    html.lang = (settings && settings.language) || "en";
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
      el.textContent = "Not scanned yet";
      return;
    }
    el.classList.add("pill-" + risk.pill);
    el.textContent = risk.label;
  }

  // The central risk engine uses four categories. Each has a text label and its own shape (see theme.css).
  const CATEGORY_PILLS = {
    LOW: { cls: "pill-low", label: "Low risk" },
    MEDIUM: { cls: "pill-caution", label: "Medium risk" },
    HIGH: { cls: "pill-danger", label: "High risk" },
    CRITICAL: { cls: "pill-critical", label: "Critical risk" },
    INCONCLUSIVE: { cls: "pill-unknown", label: "Inconclusive" },
    NOT_SCANNED: { cls: "pill-unknown", label: "Not scanned yet" },
  };

  /** Set a pill from a risk-engine category. Unknown values show "Not scanned yet". */
  function setCategoryPill(el, category) {
    ["pill-unknown", "pill-low", "pill-caution", "pill-danger", "pill-critical"].forEach((c) => el.classList.remove(c));
    const pill = CATEGORY_PILLS[category] || CATEGORY_PILLS.NOT_SCANNED;
    el.classList.add(pill.cls);
    el.textContent = pill.label;
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

  H.ui = { placeMascots, applyPrefs, toast, formatDate, setRiskPill, setCategoryPill, renderIndicators };
})();

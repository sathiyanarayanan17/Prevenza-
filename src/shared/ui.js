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

  H.ui = { placeMascots, applyPrefs, toast, formatDate };
})();

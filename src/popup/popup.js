/* Prevenza: popup. Talks to the background worker for settings and to the content script of the current tab. */
(function () {
  "use strict";
  const H = self.Prevenza;
  const MSG = H.MSG;
  const $ = (id) => document.getElementById(id);

  const el = {
    enabled: $("enabled"),
    sub: $("protection-sub"),
    site: $("site"),
    riskPill: $("risk-pill"),
    riskHelp: $("risk-help"),
    why: $("why"),
    reasons: $("reasons"),
    holdy: $("holdy-slot"),
    status: $("status"),
    version: $("version"),
    preview: $("preview"),
  };

  let settings = null;

  const NOT_SCANNED_HELP = "Open a website to see it here. Chrome keeps its own pages private.";

  function resetRisk(helpText) {
    H.ui.setRiskPill(el.riskPill, null);
    el.riskHelp.textContent = helpText;
    el.why.hidden = true;
    el.reasons.textContent = "";
    el.holdy.textContent = "";
  }

  // Step 7: Prevy speaks in the popup only when there is a real warning (MEDIUM or higher), and briefly.
  // A LOW page stays silent, as the project rules require.
  function showHoldy(assessment) {
    el.holdy.textContent = "";
    if (!assessment || !["MEDIUM", "HIGH", "CRITICAL"].includes(assessment.category)) return;
    H.holdyCard.render(el.holdy, assessment, {
      context: "url",
      compact: true,
      onReview: () => {
        el.why.open = true;
        el.why.querySelector("summary").focus();
      },
    });
  }

  function renderProtection() {
    el.enabled.checked = !!settings.enabled;
    el.sub.textContent = settings.enabled
      ? "On. Prevenza is keeping watch quietly."
      : "Off. Prevenza will not do anything until you turn it on.";
    H.ui.applyPrefs(settings);
  }

  async function loadState() {
    const state = await H.messaging.send({ type: MSG.GET_STATE });
    if (!state.ok) {
      el.sub.textContent = "Prevenza could not start. Try reloading the extension.";
      el.enabled.disabled = true;
      return false;
    }
    settings = state.settings;
    el.version.textContent = "v" + state.version;
    renderProtection();
    return true;
  }

  // Ask the background worker to check the site name of the open tab. Only the site name and protocol are sent.
  async function scanSite(tab) {
    const reply = await H.messaging.send({ type: MSG.ANALYZE_SITE, payload: { hostname: tab.hostname, protocol: tab.protocol } });
    if (!reply.ok) return resetRisk("This site could not be checked.");
    if (reply.skipped === "protection-off") return resetRisk("Protection is off, so this page was not checked.");
    if (reply.skipped === "quiet-site") return resetRisk("You muted this site, so Prevenza stays quiet here and did not check it.");
    const result = reply.result;
    if (!result || !result.ok) return resetRisk("This address could not be checked.");

    H.ui.setRiskPill(el.riskPill, result.level);
    el.riskHelp.textContent = result.summary;
    if (result.hostUnicode && result.hostUnicode !== result.host) el.site.textContent = result.hostUnicode + " (" + result.host + ")";
    H.ui.renderIndicators(el.reasons, result.indicators, 4);
    el.why.hidden = result.indicators.length === 0;
    showHoldy(reply.assessment);
  }

  async function loadTab() {
    const tab = await H.messaging.sendToActiveTab({ type: MSG.GET_TAB_STATUS });
    if (tab.ok) {
      el.site.textContent = tab.hostname || "(this page)";
      el.preview.disabled = false;
      await scanSite(tab);
    } else {
      el.site.textContent = "Browser pages can't be protected";
      resetRisk(NOT_SCANNED_HELP);
      el.preview.disabled = true;
    }
  }

  el.enabled.addEventListener("change", async () => {
    const wanted = el.enabled.checked;
    const reply = await H.messaging.send({ type: MSG.UPDATE_SETTINGS, payload: { settings: { enabled: wanted } } });
    if (reply.ok) {
      settings = reply.settings;
      renderProtection();
      await loadTab();
    } else {
      el.enabled.checked = !wanted;
      el.status.textContent = "Could not save that change.";
    }
  });

  $("open-dashboard").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html") });
    window.close();
  });

  // The message checker lives on the dashboard: a popup closes when it loses focus, which would lose a pasted message.
  $("open-message-check").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html#message-check") });
    window.close();
  });

  $("open-settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // Emergency Help lives on its own page for the same reason: a popup closes when it loses focus.
  $("open-emergency").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/emergency/emergency.html") });
    window.close();
  });

  // Elder Mode: the guide is information only, and it lives on the dashboard for the same reason as the message checker.
  $("open-trust").addEventListener("click", () => {
    chrome.tabs.create({ url: chrome.runtime.getURL("src/dashboard/dashboard.html#trust-guide") });
    window.close();
  });

  el.preview.addEventListener("click", async () => {
    const reply = await H.messaging.sendToActiveTab({ type: MSG.PREVIEW_ASSISTANT });
    if (reply.ok && reply.shown) {
      el.status.textContent = "Prevy says hi on the page.";
    } else if (reply.ok) {
      el.status.textContent = "Prevy is hidden because protection is off or this site is muted.";
    } else {
      el.status.textContent = "Prevy can't appear on this page.";
    }
  });

  H.ui.placeMascots(document);
  loadState().then((ok) => (ok ? loadTab() : undefined));
})();

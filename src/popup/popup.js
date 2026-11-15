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
    status: $("status"),
    version: $("version"),
    preview: $("preview"),
  };

  let settings = null;

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

  async function loadTab() {
    const tab = await H.messaging.sendToActiveTab({ type: MSG.GET_TAB_STATUS });
    if (tab.ok) {
      el.site.textContent = tab.hostname || "(this page)";
      el.preview.disabled = false;
      if (tab.muted) {
        el.riskHelp.textContent = "You muted this site, so Prevenza stays quiet here.";
      } else if (!tab.enabled) {
        el.riskHelp.textContent = "Protection is off.";
      }
    } else {
      el.site.textContent = "Browser pages can't be protected";
      el.riskHelp.textContent = "Open a website to see it here. Chrome keeps its own pages private.";
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

  $("open-settings").addEventListener("click", () => {
    chrome.runtime.openOptionsPage();
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

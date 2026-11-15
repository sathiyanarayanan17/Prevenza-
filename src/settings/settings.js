/* Prevenza: settings page. Saves through the background worker so every part of the extension stays in sync. */
(function () {
  "use strict";
  const H = self.Prevenza;
  const MSG = H.MSG;
  const $ = (id) => document.getElementById(id);

  const el = {
    enabled: $("enabled"),
    elderMode: $("elderMode"),
    showAssistantBadge: $("showAssistantBadge"),
    language: $("language"),
    sensitivity: $("sensitivity"),
    sensHelp: $("sens-help"),
    form: $("add-form"),
    input: $("site-input"),
    error: $("site-error"),
    sites: $("sites"),
    sitesEmpty: $("sites-empty"),
    resetStats: $("reset-stats"),
    resetSettings: $("reset-settings"),
  };

  let settings = null;

  function fillSelect(select, items) {
    items.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      select.appendChild(option);
    });
  }

  function renderSites() {
    el.sites.textContent = "";
    settings.mutedSites.forEach((name) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.className = "name";
      label.textContent = name;
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "btn";
      remove.textContent = "Remove";
      remove.setAttribute("aria-label", "Remove " + name);
      remove.addEventListener("click", () => save({ mutedSites: settings.mutedSites.filter((s) => s !== name) }, "Site removed."));
      li.append(label, remove);
      el.sites.appendChild(li);
    });
    el.sitesEmpty.hidden = settings.mutedSites.length > 0;
  }

  function render() {
    el.enabled.checked = settings.enabled;
    el.elderMode.checked = settings.elderMode;
    el.showAssistantBadge.checked = settings.showAssistantBadge;
    el.language.value = settings.language;
    el.sensitivity.value = settings.sensitivity;
    const level = H.SENSITIVITY.find((s) => s.id === settings.sensitivity);
    el.sensHelp.textContent = level ? level.help : "";
    renderSites();
    H.ui.applyPrefs(settings);
  }

  async function save(patch, message) {
    const reply = await H.messaging.send({ type: MSG.UPDATE_SETTINGS, payload: { settings: patch } });
    if (reply.ok) {
      settings = reply.settings;
      render();
      H.ui.toast(message || "Saved.");
      return true;
    }
    render(); // put the controls back to the last saved values
    H.ui.toast("Could not save. Please try again.", "error");
    return false;
  }

  el.enabled.addEventListener("change", () => save({ enabled: el.enabled.checked }));
  el.elderMode.addEventListener("change", () => save({ elderMode: el.elderMode.checked }));
  el.showAssistantBadge.addEventListener("change", () => save({ showAssistantBadge: el.showAssistantBadge.checked }));
  el.language.addEventListener("change", () => save({ language: el.language.value }));
  el.sensitivity.addEventListener("change", () => save({ sensitivity: el.sensitivity.value }));

  el.form.addEventListener("submit", async (event) => {
    event.preventDefault();
    el.error.textContent = "";
    const name = H.normalizeHostname(el.input.value);
    if (!name) {
      el.error.textContent = "That does not look like a website name. Try something like example.com.";
      return;
    }
    if (settings.mutedSites.includes(name)) {
      el.error.textContent = name + " is already in the list.";
      return;
    }
    if (settings.mutedSites.length >= H.LIMITS.maxMutedSites) {
      el.error.textContent = "The list is full.";
      return;
    }
    if (await save({ mutedSites: settings.mutedSites.concat(name) }, name + " added.")) el.input.value = "";
  });

  // Destructive buttons need a second click, so nothing is lost by accident (and no pop-up dialogs).
  function confirmTwice(button, idleText, action) {
    let armed = false;
    let timer = null;
    button.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        button.textContent = "Click again to confirm";
        timer = setTimeout(() => {
          armed = false;
          button.textContent = idleText;
        }, 4000);
        return;
      }
      clearTimeout(timer);
      armed = false;
      button.textContent = idleText;
      await action();
    });
  }

  confirmTwice(el.resetStats, "Reset statistics", async () => {
    const reply = await H.messaging.send({ type: MSG.RESET_STATS });
    H.ui.toast(reply.ok ? "Statistics reset." : "Could not reset.", reply.ok ? "ok" : "error");
  });

  confirmTwice(el.resetSettings, "Restore default settings", async () => {
    const reply = await H.messaging.send({ type: MSG.RESET_SETTINGS });
    if (reply.ok) {
      settings = reply.settings;
      render();
      H.ui.toast("Default settings restored.");
    } else {
      H.ui.toast("Could not restore settings.", "error");
    }
  });

  async function start() {
    H.ui.placeMascots(document);
    fillSelect(el.language, H.LANGUAGES);
    fillSelect(el.sensitivity, H.SENSITIVITY);
    const state = await H.messaging.send({ type: MSG.GET_STATE });
    if (!state.ok) {
      H.ui.toast("Prevenza could not load your settings.", "error");
      return;
    }
    settings = state.settings;
    render();
  }

  start();
})();

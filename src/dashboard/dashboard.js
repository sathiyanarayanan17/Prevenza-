/* Prevenza: dashboard. Read-only summary plus a system check that proves messaging and storage work. */
(function () {
  "use strict";
  const H = self.Prevenza;
  const MSG = H.MSG;
  const $ = (id) => document.getElementById(id);

  // Ideas for later steps. Shown honestly as "Planned", never as working features.
  const ROADMAP = [
    ["Smart URL checks", "Ready"],
    ["Scam message checker (English, Hindi, Tamil, Hinglish)", "Ready"],
    ["Scam risk score for links and pages", "Planned"],
    ["UPI payment analyzer", "Planned"],
    ["Payment screenshot reader", "Planned"],
    ["Prevy emergency help and safety button", "Planned"],
    ["Community scam alerts", "Planned"],
    ["Warning pop-up before a risky page", "Planned"],
    ["Elder mode", "Ready"],
  ];

  function renderLegend() {
    const list = $("legend");
    H.RISK_LEVELS.forEach((level) => {
      const li = document.createElement("li");
      const pill = document.createElement("span");
      pill.className = "pill pill-" + (level.pill || level.id);
      pill.textContent = level.label;
      const help = document.createElement("span");
      help.className = "muted small";
      help.textContent = level.help;
      li.append(pill, help);
      list.appendChild(li);
    });
  }

  function renderRoadmap() {
    const list = $("road");
    ROADMAP.forEach(([name, status]) => {
      const li = document.createElement("li");
      const label = document.createElement("span");
      label.textContent = name;
      const chip = document.createElement("span");
      chip.className = "chip" + (status === "Ready" ? " chip-ready" : "");
      chip.textContent = status;
      li.append(label, chip);
      list.appendChild(li);
    });
  }

  function renderState(state) {
    const { settings, stats } = state;
    H.ui.applyPrefs(settings);
    $("stat-protection").textContent = settings.enabled ? "On" : "Off";
    $("stat-pages").textContent = String(stats.pagesSeen);
    $("stat-warnings").textContent = String(stats.warningsShown);
    $("stat-last").textContent = H.ui.formatDate(stats.lastActiveAt);
    $("stat-installed").textContent = stats.installedAt ? "Installed " + H.ui.formatDate(stats.installedAt) : "";
    $("hero-sub").textContent = settings.enabled
      ? "Prevenza is on and keeping watch quietly. Link checks and the message checker are ready."
      : "Protection is off. Turn it on in Settings.";
  }

  function addCheck(ok, text) {
    const li = document.createElement("li");
    li.className = ok ? "ok" : "bad";
    const mark = document.createElement("span");
    mark.className = "mark";
    mark.textContent = ok ? "\u2713" : "!";
    const label = document.createElement("span");
    label.textContent = text;
    li.append(mark, label);
    $("checks").appendChild(li);
  }

  async function runCheck() {
    const button = $("run-check");
    button.disabled = true;
    $("checks").textContent = "";

    const started = performance.now();
    const ping = await H.messaging.send({ type: MSG.PING });
    const ms = Math.round(performance.now() - started);
    addCheck(ping.ok && ping.pong === true, ping.ok ? "Background worker answered in " + ms + " ms (v" + ping.version + ")" : "Background worker did not answer");

    const diag = await H.messaging.send({ type: MSG.DIAGNOSTICS });
    addCheck(diag.ok && diag.storageOk === true, diag.ok && diag.storageOk ? "Storage can save and read data" : "Storage check failed");

    const tabs = await H.messaging.sendToAllTabs({ type: MSG.GET_TAB_STATUS });
    addCheck(tabs.length > 0, tabs.length > 0
      ? "Page watcher is active on " + tabs.length + " open " + (tabs.length === 1 ? "tab" : "tabs")
      : "Page watcher not found. Open a website, then run the check again.");

    const state = await H.messaging.send({ type: MSG.GET_STATE });
    if (state.ok) renderState(state);
    button.disabled = false;
  }

  async function start() {
    H.ui.placeMascots(document);
    renderLegend();
    renderRoadmap();
    const state = await H.messaging.send({ type: MSG.GET_STATE });
    if (state.ok) {
      renderState(state);
    } else {
      $("hero-sub").textContent = "Prevenza could not load its data. Try reloading the extension.";
    }
  }

  // ---- link checker: the user pastes an address. It is analysed in memory and never stored.
  function paragraph(text, className) {
    const p = document.createElement("p");
    if (className) p.className = className;
    p.textContent = text;
    return p;
  }

  function showLinkResult(reply) {
    const box = $("link-result");
    box.textContent = "";
    if (!reply.ok) {
      box.appendChild(paragraph("Prevenza could not check that right now. Please try again.", "problem"));
      return;
    }
    if (reply.skipped === "protection-off") {
      box.appendChild(paragraph("Protection is off, so links are not checked. Turn it on in Settings.", "muted"));
      return;
    }
    const result = reply.result;
    if (!result.ok) {
      box.appendChild(paragraph(result.message, "problem"));
      return;
    }
    const verdict = document.createElement("div");
    verdict.className = "verdict";
    const pill = document.createElement("span");
    pill.className = "pill";
    H.ui.setRiskPill(pill, result.level);
    const host = document.createElement("span");
    host.className = "host";
    host.textContent = result.hostUnicode !== result.host ? result.hostUnicode + " (" + result.host + ")" : result.host;
    verdict.append(pill, host);
    box.appendChild(verdict);
    box.appendChild(paragraph(result.summary, "muted"));
    if (result.assumedScheme) box.appendChild(paragraph("You did not type http or https, so this was checked as https.", "muted small note"));
    if (reply.quietSite) box.appendChild(paragraph("You marked this site as quiet, so Prevenza will not interrupt you there. This check ran because you asked for it.", "muted small note"));
    const list = document.createElement("ul");
    list.className = "reasons";
    H.ui.renderIndicators(list, result.indicators);
    if (result.indicators.length) box.appendChild(list);
    else box.appendChild(paragraph("Nothing unusual was found in the address.", "muted small note"));
  }

  $("link-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    const reply = await H.messaging.send({ type: MSG.CHECK_URL, payload: { url: $("link-input").value } });
    showLinkResult(reply);
  });

  $("run-check").addEventListener("click", runCheck);
  start();
})();

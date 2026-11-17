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
    ["UPI payment analyzer", "Ready"],
    ["Screenshot reader (offline text reading)", "Ready"],
    ["Prevy warnings that adapt to every check", "Ready"],
    ["One dashboard for every check, with privacy-safe counts", "Ready"],
    ["Risk score and warning on the page you are visiting", "Planned"],
    ["Prevy emergency help and safety button", "Ready"],
    ["Whole interface in Hindi and Tamil", "Planned"],
    ["Community scam alerts", "Planned"],
    ["Optional online checks, off by default", "Planned"],
    ["Warning pop-up before a risky page", "Planned"],
    ["Elder mode", "Ready"],
  ];

  // Step 11: the legend lists every state a result can have, from the central risk engine (one scale everywhere).
  const LEGEND = [
    ["NOT_SCANNED", "Nothing has been checked yet."],
    ["LOW", "No strong warning signs in what was checked. This is not a guarantee."],
    ["MEDIUM", "Some unusual signs. Check carefully before you act."],
    ["HIGH", "Strong warning signs. Do not pay or share details until you have verified."],
    ["CRITICAL", "A clear, serious warning sign. Stop and check first."],
    ["INCONCLUSIVE", "Prevenza could not decide. This is never treated as safe."],
  ];
  function renderLegend() {
    const list = $("legend");
    LEGEND.forEach(([category, text]) => {
      const li = document.createElement("li");
      const pill = document.createElement("span");
      pill.className = "pill";
      H.ui.setCategoryPill(pill, category);
      const help = document.createElement("span");
      help.className = "muted small";
      help.textContent = text;
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

  // The "Ask someone you trust" guide (Elder Mode). Information only. Built again only when the language changes,
  // so an open guide stays open when the system check refreshes the page.
  let trustLanguage = null;
  function renderTrust(language) {
    if (trustLanguage === language || !H.familyGuide) return;
    trustLanguage = language;
    H.familyGuide.render($("trust-slot"), language, { noTitle: true, open: location.hash === "#trust-guide" });
  }

  // Step 10: the overview counts. Numbers only, from the aggregate counters. If they cannot be read, say so.
  function renderCounts(stats) {
    const ids = ["stat-scans", "stat-high", "stat-lowmed", "stat-inconclusive", "stat-lastscan"];
    if (!stats || typeof stats.scansTotal !== "number") {
      ids.forEach((id) => {
        $(id).textContent = "Unavailable";
      });
      return;
    }
    $("stat-scans").textContent = String(stats.scansTotal);
    $("stat-high").textContent = String(stats.scansHigh + stats.scansCritical);
    $("stat-lowmed").textContent = String(stats.scansLow + stats.scansMedium);
    $("stat-inconclusive").textContent = String(stats.scansInconclusive);
    $("stat-lastscan").textContent = stats.lastScanAt ? H.ui.formatDate(stats.lastScanAt) : "No checks yet";
  }

  function renderState(state) {
    const { settings, stats } = state;
    H.ui.applyPrefs(settings);
    renderTrust(settings.language);
    renderCounts(stats);
    $("stat-protection").textContent = settings.enabled ? "On" : "Off";
    $("stat-pages").textContent = String(stats.pagesSeen);
    $("stat-warnings").textContent = String(stats.warningsShown);
    $("stat-last").textContent = H.ui.formatDate(stats.lastActiveAt);
    $("stat-installed").textContent = stats.installedAt ? "Installed " + H.ui.formatDate(stats.installedAt) : "";
    $("hero-sub").textContent = settings.enabled
      ? "Prevenza is on and keeping watch quietly. You can check links, messages, UPI payments and screenshots below."
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
      $("stat-protection").textContent = "Unavailable";
      renderCounts(null);
    }
  }

  // ---- Step 10: the latest result on this page (kept in this page's memory only), and fresh counts after each check.
  document.addEventListener("prevenza:checked", (event) => {
    const category = event.detail && event.detail.category;
    H.ui.setCategoryPill($("overall-pill"), category);
  });
  document.addEventListener("prevenza:stats", async (event) => {
    if (event.detail && event.detail.stats) return renderCounts(event.detail.stats);
    const state = await H.messaging.send({ type: MSG.GET_STATE });
    if (state.ok) renderCounts(state.stats);
  });

  // ---- Step 10: the menu cards. Each one goes to the existing checker and puts the keyboard focus in its first field.
  function focusTool(hash) {
    const card = document.querySelector('.tool-card[href="' + hash + '"]');
    const target = card && $(card.getAttribute("data-target"));
    if (target) target.focus();
  }
  document.querySelectorAll(".tool-card[data-target]").forEach((card) => {
    card.addEventListener("click", () => setTimeout(() => focusTool(card.getAttribute("href")), 0));
  });
  document.querySelectorAll(".back-link").forEach((link) => {
    link.addEventListener("click", () => setTimeout(() => $("tools-h").focus(), 0));
  });

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
      box.appendChild(paragraph(H.riskResult.problemText(reply), "problem"));
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
    // Step 11: the pill and the sentence come from the central risk engine's category, never from a second scale.
    const category = reply.assessment && reply.assessment.category;
    H.ui.setCategoryPill(pill, category);
    const host = document.createElement("span");
    host.className = "host";
    host.textContent = result.hostUnicode !== result.host ? result.hostUnicode + " (" + result.host + ")" : result.host;
    verdict.append(pill, host);
    box.appendChild(verdict);
    box.appendChild(paragraph(H.ui.urlSummaryFor(category) || "This address could not be rated. That does not mean it is safe.", "muted"));
    // Step 10: the central risk engine's view of this address, in the same summary every checker uses.
    if (reply.assessment) {
      box.appendChild(H.riskResult.render(reply.assessment, { label: "Overall result from the central risk engine" }));
      H.riskResult.record(reply.assessment);
    }
    if (result.assumedScheme) box.appendChild(paragraph("You did not type http or https, so this was checked as https.", "muted small note"));
    if (reply.quietSite) box.appendChild(paragraph("You marked this site as quiet, so Prevenza will not interrupt you there. This check ran because you asked for it.", "muted small note"));
    const list = document.createElement("ul");
    list.className = "reasons";
    H.ui.renderIndicators(list, result.indicators);
    // Prevy's card or note (Step 7), from the central risk engine's view of this address.
    const holdySlot = document.createElement("div");
    holdySlot.className = "holdy-slot";
    box.appendChild(holdySlot);
    if (reply.assessment) H.holdyCard.render(holdySlot, reply.assessment, { context: "url", reviewTarget: () => list });
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

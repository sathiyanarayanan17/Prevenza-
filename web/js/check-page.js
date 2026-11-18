/*
 * Prevenza website: the checker page (web/app/check.html).
 * The message, UPI and screenshot checkers are the extension's own scripts (src/dashboard/*-check.js). This file adds
 * what the extension dashboard does in dashboard.js and the settings page: the link checker display, language and
 * Elder Mode, the counts, the risk legend and the "latest check" pill. Text is only ever inserted as text.
 */
(function () {
  "use strict";
  const H = self.Prevenza;
  const MSG = H.MSG;
  const $ = (id) => document.getElementById(id);

  // The legend lists every state a result can have, from the central risk engine (one scale everywhere).
  const LEGEND = [
    ["NOT_SCANNED", "Nothing has been checked yet."],
    ["LOW", "No strong warning signs in what was checked. This is not a guarantee."],
    ["MEDIUM", "Some unusual signs. Check carefully before you act."],
    ["HIGH", "Strong warning signs. Do not pay or share details until you have verified."],
    ["CRITICAL", "A clear, serious warning sign. Stop and check first."],
    ["INCONCLUSIVE", "Prevenza could not decide. This is never treated as safe."],
  ];

  let settings = null;

  function paragraph(text, className) {
    const p = document.createElement("p");
    if (className) p.className = className;
    p.textContent = text;
    return p;
  }

  function renderLegend() {
    const list = $("legend");
    LEGEND.forEach(([category, text]) => {
      const li = document.createElement("li");
      const pill = document.createElement("span");
      pill.className = "pill";
      H.ui.setCategoryPill(pill, category);
      li.append(pill, paragraph(text, "muted small"));
      list.appendChild(li);
    });
  }

  // ---- counts: numbers only, from the aggregate counters. If they cannot be read, say so.
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

  // ---- preferences: language and Elder Mode, saved through the same router and store as the extension.
  let trustLanguage = null;
  function renderTrust(language) {
    if (trustLanguage === language || !H.familyGuide) return;
    trustLanguage = language;
    H.familyGuide.render($("trust-slot"), language, { noTitle: true, open: location.hash === "#trust-guide" });
  }

  function renderPrefs() {
    $("pref-language").value = settings.language;
    $("pref-elder").checked = settings.elderMode;
    H.ui.applyPrefs(settings);
    renderTrust(settings.language);
  }

  async function savePrefs(patch) {
    const reply = await H.messaging.send({ type: MSG.UPDATE_SETTINGS, payload: { settings: patch } });
    if (reply.ok) {
      settings = reply.settings;
      H.ui.toast("Saved.");
    } else {
      H.ui.toast("Could not save. Please try again.", "error");
    }
    renderPrefs();
  }

  function fillLanguages() {
    const select = $("pref-language");
    H.LANGUAGES.forEach((item) => {
      const option = document.createElement("option");
      option.value = item.id;
      option.textContent = item.label;
      select.appendChild(option);
    });
  }

  // Reset needs a second press, so nothing is lost by accident (and no pop-up dialogs).
  function confirmTwice(button, idleText, action) {
    let armed = false;
    let timer = null;
    button.addEventListener("click", async () => {
      if (!armed) {
        armed = true;
        button.textContent = "Press again to confirm";
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

  // ---- link checker: the user pastes an address. It is analysed in memory and never stored.
  function showLinkResult(reply) {
    const box = $("link-result");
    box.textContent = "";
    if (!reply.ok) {
      box.appendChild(paragraph(H.riskResult.problemText(reply), "problem"));
      return;
    }
    if (reply.skipped === "protection-off") {
      box.appendChild(paragraph("Checking is switched off in this browser's saved settings, so this link was not checked.", "muted"));
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
    // The pill and the sentence come from the central risk engine's category, never from a second scale.
    const category = reply.assessment && reply.assessment.category;
    H.ui.setCategoryPill(pill, category);
    const host = document.createElement("span");
    host.className = "host";
    host.textContent = result.hostUnicode !== result.host ? result.hostUnicode + " (" + result.host + ")" : result.host;
    verdict.append(pill, host);
    box.appendChild(verdict);
    box.appendChild(paragraph(H.ui.urlSummaryFor(category) || "This address could not be rated. That does not mean it is safe.", "muted"));
    if (reply.assessment) {
      box.appendChild(H.riskResult.render(reply.assessment, { label: "Overall result from the central risk engine" }));
      H.riskResult.record(reply.assessment);
    }
    if (result.assumedScheme) box.appendChild(paragraph("You did not type http or https, so this was checked as https.", "muted small note"));
    const list = document.createElement("ul");
    list.className = "reasons";
    H.ui.renderIndicators(list, result.indicators);
    const holdySlot = document.createElement("div");
    holdySlot.className = "holdy-slot";
    box.appendChild(holdySlot);
    if (reply.assessment) H.holdyCard.render(holdySlot, reply.assessment, { context: "url", reviewTarget: () => list });
    if (result.indicators.length) box.appendChild(list);
    else box.appendChild(paragraph("Nothing unusual was found in the address.", "muted small note"));
  }

  $("link-form").addEventListener("submit", async (event) => {
    event.preventDefault();
    showLinkResult(await H.messaging.send({ type: MSG.CHECK_URL, payload: { url: $("link-input").value } }));
  });

  // ---- menu cards: go to the checker and put the keyboard focus in its first field.
  document.querySelectorAll(".tool-card[data-target]").forEach((card) => {
    card.addEventListener("click", () =>
      setTimeout(() => {
        const target = $(card.getAttribute("data-target"));
        if (target) target.focus();
      }, 0)
    );
  });
  document.querySelectorAll(".back-link").forEach((link) => {
    link.addEventListener("click", () => setTimeout(() => $("tools-h").focus(), 0));
  });

  // ---- the latest result on this page (kept in this page's memory only), and fresh counts after each check.
  document.addEventListener("prevenza:checked", (event) => {
    H.ui.setCategoryPill($("overall-pill"), event.detail && event.detail.category);
  });
  document.addEventListener("prevenza:stats", async (event) => {
    if (event.detail && event.detail.stats) return renderCounts(event.detail.stats);
    const state = await H.messaging.send({ type: MSG.GET_STATE });
    renderCounts(state.ok ? state.stats : null);
  });

  async function start() {
    H.ui.placeMascots(document);
    renderLegend();
    fillLanguages();
    $("pref-language").addEventListener("change", () => savePrefs({ language: $("pref-language").value }));
    $("pref-elder").addEventListener("change", () => savePrefs({ elderMode: $("pref-elder").checked }));
    confirmTwice($("reset-stats"), "Reset statistics", async () => {
      const reply = await H.messaging.send({ type: MSG.RESET_STATS });
      if (reply.ok) renderCounts(reply.stats);
      H.ui.toast(reply.ok ? "Statistics reset." : "Could not reset.", reply.ok ? "ok" : "error");
    });
    if (H.web && !H.web.storageIsPersistent()) $("prefs-note").textContent = "This browser does not allow saving, so these choices last until you close the page.";

    const state = await H.messaging.send({ type: MSG.GET_STATE });
    if (state.ok) {
      settings = state.settings;
      renderPrefs();
      renderCounts(state.stats);
    } else {
      renderCounts(null);
    }
  }

  start();
})();

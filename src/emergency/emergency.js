/*
 * Prevenza: Emergency Help page (Step 9). DOM and text nodes only, never HTML.
 *
 * It shows safety steps for the situation the user picks, the official places to report financial cyber fraud in
 * India, and the "Ask someone you trust" guide. It stores nothing: the chosen situation lives only in this page's
 * memory and in the address fragment (for example #money), which holds no personal information.
 *
 * It never calls anyone, sends anything or submits a complaint. The only actions are two the user starts themselves:
 * opening the official portal in a new tab (an ordinary link) and copying the helpline number to the clipboard.
 * Elder Mode shows one step at a time, in simpler words.
 */
(function () {
  "use strict";
  const H = self.Prevenza;
  const E = H.emergency;
  const T = E.TEXT;
  const OFFICIAL = E.OFFICIAL;
  const $ = (id) => document.getElementById(id);

  let currentId = null;
  let stepIndex = 0;

  function el(tag, className, text) {
    const n = document.createElement(tag);
    if (className) n.className = className;
    if (text !== undefined) n.textContent = text;
    return n;
  }

  function isElder() {
    return document.documentElement.getAttribute("data-elder") === "true";
  }

  // ---- incident picker
  function buildPicker() {
    const list = $("incident-list");
    list.textContent = "";
    E.INCIDENTS.forEach((incident) => {
      const b = el("button", "btn incident-btn", incident.label);
      b.type = "button";
      b.setAttribute("data-incident", incident.id);
      b.setAttribute("aria-pressed", "false");
      b.addEventListener("click", () => select(incident.id, true));
      list.appendChild(b);
    });
  }

  function markPressed() {
    $("incident-list").querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", b.getAttribute("data-incident") === currentId ? "true" : "false");
    });
  }

  function setMessage(text) {
    const msg = $("pick-msg");
    msg.textContent = text || "";
    msg.hidden = !text;
  }

  // ---- steps
  function renderSteps() {
    const incident = E.getIncident(currentId);
    const card = $("steps-card");
    const body = $("steps-body");
    body.textContent = "";
    card.hidden = !incident;
    $("steps-empty").hidden = !!incident;
    if (!incident) return;

    $("steps-kicker").textContent = T.stepsHeading;
    $("steps-h").textContent = incident.title;
    const elder = isElder();
    const steps = E.stepsFor(incident.id, elder);

    if (!elder) {
      const ol = el("ol", "steps");
      steps.forEach((s) => ol.appendChild(el("li", null, s)));
      body.appendChild(ol);
      body.appendChild(el("p", "muted small", T.limits));
      return;
    }

    // Elder Mode: one step at a time.
    const count = el("p", "step-count");
    count.id = "step-count";
    const now = el("p", "step-now");
    now.id = "step-now";
    now.tabIndex = -1;
    now.setAttribute("aria-live", "polite");
    const done = el("p", "muted", T.last);
    done.hidden = true;
    const row = el("div", "btn-row");
    const prev = el("button", "btn", T.back);
    prev.type = "button";
    prev.id = "step-prev";
    const next = el("button", "btn btn-primary", T.next);
    next.type = "button";
    next.id = "step-next";
    row.append(prev, next);
    body.append(count, now, row, done);

    function show(focusTarget) {
      count.textContent = E.stepLabel(stepIndex + 1, steps.length);
      now.textContent = steps[stepIndex];
      prev.hidden = stepIndex === 0;
      const atEnd = stepIndex === steps.length - 1;
      next.hidden = atEnd;
      done.hidden = !atEnd;
      if (focusTarget === "now" || (focusTarget === "next" && atEnd) || (focusTarget === "prev" && stepIndex === 0)) now.focus();
    }
    prev.addEventListener("click", () => {
      if (stepIndex > 0) stepIndex--;
      show("prev");
    });
    next.addEventListener("click", () => {
      if (stepIndex < steps.length - 1) stepIndex++;
      show("next");
    });
    show();
  }

  function select(id, userAction) {
    if (!E.getIncident(id)) return invalid();
    currentId = id;
    stepIndex = 0;
    setMessage("");
    markPressed();
    renderSteps();
    try {
      history.replaceState(null, "", "#" + id);
    } catch (e) {
      /* the address is only a convenience */
    }
    if (userAction) $("steps-h").focus();
  }

  function invalid() {
    currentId = null;
    stepIndex = 0;
    markPressed();
    renderSteps();
    setMessage(T.invalid);
  }

  function handleHash() {
    const parsed = E.parseHash(location.hash);
    if (parsed.state === "valid") select(parsed.id, false);
    else if (parsed.state === "invalid") invalid();
    else {
      currentId = null;
      markPressed();
      renderSteps();
      setMessage("");
    }
  }

  // ---- reporting guidance (information and two user-started actions)
  function buildReport() {
    const elder = isElder();
    $("report-h").textContent = T.reportHeading;
    $("report-intro").textContent = elder ? T.reportIntroElder : T.reportIntro;
    $("bank-reminder").textContent = T.bankReminder;
    $("portal-h").textContent = OFFICIAL.portalName;
    $("portal-address").textContent = OFFICIAL.portalUrl;

    const link = $("portal-link");
    link.textContent = T.portalButton;
    link.href = OFFICIAL.portalUrl;
    const hint = el("span", "visually-hidden", " (opens in a new tab)");
    link.appendChild(hint);

    $("helpline-h").textContent = OFFICIAL.helplineName;
    $("helpline-number").textContent = OFFICIAL.helplineNumber;
    $("copy-helpline").textContent = T.copyButton;

    const more = $("report-more-body");
    more.textContent = "";
    [T.portalHelp, T.helplineHelp, T.verifyNote, T.outside, T.limits].forEach((t) => more.appendChild(el("p", "muted small", t)));
    $("report-more").open = !elder;
  }

  async function copyHelpline() {
    let ok = false;
    try {
      await navigator.clipboard.writeText(OFFICIAL.helplineNumber);
      ok = true;
    } catch (e) {
      ok = false;
    }
    $("copy-status").textContent = ok ? T.copied : T.copyFailed;
  }

  // ---- trust guide (Step 8 guide, plus the specified sentence)
  function buildTrust(language) {
    $("trust-emg-h").textContent = T.trustHeading;
    $("trust-sentence").textContent = E.TRUST_SENTENCE;
    if (H.familyGuide) H.familyGuide.render($("trust-slot"), language, { noTitle: true });
  }

  async function start() {
    H.ui.placeMascots(document);
    let settings = null;
    try {
      const state = await H.messaging.send({ type: H.MSG.GET_STATE });
      if (state && state.ok) settings = state.settings;
    } catch (e) {
      settings = null;
    }
    // Emergency Help must work even if settings cannot be read: it falls back to English and the normal layout.
    if (settings) H.ui.applyPrefs(settings);
    const language = (settings && settings.language) || "en";

    $("emg-calm").textContent = isElder() ? T.calmElder : T.calm;
    $("pick-h").textContent = T.pickHeading;
    $("pick-help").textContent = T.pickHelp;
    $("steps-empty").textContent = T.noneChosen;
    const note = $("emg-lang-note");
    note.textContent = language !== "en" ? T.languageNote : "";
    note.hidden = language === "en";

    buildPicker();
    buildReport();
    buildTrust(language);
    $("copy-helpline").addEventListener("click", copyHelpline);
    window.addEventListener("hashchange", handleHash);
    handleHash();
  }

  start();
})();

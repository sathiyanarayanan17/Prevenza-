/*
 * Prevenza: content script.
 *
 * PRIVACY CONTRACT (enforced by test/security.test.js):
 *   - reads only location.hostname and location.protocol
 *   - never reads form fields, passwords, cookies, page text or storage of the page
 *   - never listens to keyboard, input or paste events
 *   - never talks to the network; it only talks to this extension's background worker
 *   - silent by default: it adds nothing to the page unless the user turns the assistant badge on,
 *     asks for a preview from the popup, or (Step 12) the site name has strong scam signs
 *   - Step 12: it sends only the site name and protocol to be checked, and shows a full-page warning when the
 *     background worker says so. "Continue anyway" is always there. The warning reads nothing from the page.
 */
(function () {
  "use strict";

  const H = self.Prevenza;
  if (!H || !H.MSG || !H.sanitizeSettings || !H.mascotElement) return;
  if (document.documentElement.hasAttribute("data-prevenza-loaded")) return;
  document.documentElement.setAttribute("data-prevenza-loaded", "1");

  const MSG = H.MSG;
  const hostname = (location.hostname || "").toLowerCase();
  const PREVIEW_MS = 7000;

  let settings = null; // null until the background worker has answered
  let host = null; // the shadow-DOM host element, only present while something is visible
  let shadow = null;
  let badgeEl = null;
  let bubbleEl = null;
  let bubbleTimer = null;
  let warnHost = null; // Step 12: the full-page warning, only present while it is shown
  let warnDismissed = false; // "Continue anyway" was pressed on this page
  let warnAsked = false;

  const isMuted = () => H.isMuted(hostname, settings ? settings.mutedSites : []);
  const isActive = () => !!settings && settings.enabled && !isMuted();

  const STYLE = `
    :host { all: initial; }
    .wrap { position: fixed; right: 16px; bottom: 16px; z-index: 2147483647; display: flex; flex-direction: column; align-items: flex-end; gap: 10px; font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif; }
    .badge { width: 52px; height: 52px; border-radius: 50%; border: 2px solid #3b82f6; background: #0b1220; display: grid; place-items: center; cursor: pointer; padding: 0; box-shadow: 0 6px 18px rgba(0,0,0,.35); }
    .badge:focus-visible { outline: 3px solid #fbbf24; outline-offset: 2px; }
    .badge svg { width: 30px; height: 33px; }
    .bubble { width: 280px; background: #121d35; color: #e8eefc; border: 1px solid #2f4a7d; border-radius: 14px; padding: 12px 14px; box-shadow: 0 10px 28px rgba(0,0,0,.45); font-size: 14px; line-height: 1.45; }
    .bubble[data-elder="true"] { width: 340px; font-size: 18px; }
    .row { display: flex; gap: 10px; align-items: flex-start; }
    .row svg { flex: none; width: 36px; height: 39px; }
    .title { font-weight: 700; margin: 0 0 2px; }
    .text { margin: 0; color: #c7d4ee; }
    .close { margin-left: auto; background: transparent; border: 0; color: #a3b3d1; font-size: 18px; line-height: 1; cursor: pointer; padding: 0 2px; }
    .close:focus-visible { outline: 3px solid #fbbf24; }
    [hidden] { display: none !important; }
    @media (prefers-reduced-motion: no-preference) { .bubble { animation: pop .18s ease-out; } @keyframes pop { from { transform: translateY(6px); opacity: 0; } to { transform: none; opacity: 1; } } }
  `;

  // Step 12: the full-page warning. Its own shadow root, so the page's styles cannot hide or restyle it.
  const WARN_STYLE = `
    :host { all: initial; }
    .veil { position: fixed; inset: 0; z-index: 2147483647; background: rgba(5, 10, 20, .94); display: grid; place-items: center; padding: 16px; overflow: auto; font-family: system-ui, "Segoe UI", Roboto, Arial, sans-serif; }
    .box { box-sizing: border-box; width: min(560px, 100%); background: #121d35; color: #e8eefc; border: 2px solid #ef4444; border-radius: 16px; padding: 22px 22px 18px; box-shadow: 0 18px 48px rgba(0,0,0,.6); font-size: 16px; line-height: 1.5; }
    .head { display: flex; gap: 12px; align-items: center; }
    .head svg { flex: none; width: 48px; height: 52px; }
    h2 { margin: 0; font-size: 22px; line-height: 1.25; }
    .host { margin: 10px 0 0; padding: 8px 10px; background: #0b1220; border: 1px solid #2f4a7d; border-radius: 8px; overflow-wrap: anywhere; font-weight: 700; }
    .pill { display: inline-flex; align-items: center; gap: 8px; margin-top: 10px; padding: 3px 12px 3px 10px; border-radius: 999px; font-weight: 700; font-size: 14px; color: #fecaca; background: #3b0d12; border: 2px solid #ef4444; }
    .pill::before { content: ""; width: 11px; height: 11px; background: currentColor; transform: rotate(45deg); }
    .pill[data-level="CRITICAL"]::before { transform: none; clip-path: polygon(30% 0, 70% 0, 100% 30%, 100% 70%, 70% 100%, 30% 100%, 0 70%, 0 30%); }
    .pill[data-level="MEDIUM"] { color: #fcd34d; background: #2d2209; border-color: #a16207; }
    .pill[data-level="MEDIUM"]::before { transform: none; clip-path: polygon(50% 0, 100% 100%, 0 100%); }
    p { margin: 12px 0 0; }
    ul { margin: 8px 0 0; padding-left: 22px; }
    li { margin-top: 4px; }
    .note { color: #a8b8d6; font-size: 14px; }
    .row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 18px; }
    button { font: inherit; font-weight: 700; min-height: 48px; padding: 10px 18px; border-radius: 10px; cursor: pointer; border: 2px solid #3b82f6; }
    .back { background: #2563eb; color: #fff; border-color: #2563eb; }
    .go { background: transparent; color: #e8eefc; border-color: #4b5f86; }
    button:focus-visible { outline: 3px solid #fbbf24; outline-offset: 2px; }
    .box[data-elder="true"] { font-size: 22px; width: min(640px, 100%); }
    .box[data-elder="true"] h2 { font-size: 28px; }
    .box[data-elder="true"] button { min-height: 60px; font-size: 22px; flex: 1 1 100%; }
    .box[data-elder="true"] .note { font-size: 18px; }
    @media (prefers-reduced-motion: no-preference) { .box { animation: rise .2s ease-out; } @keyframes rise { from { transform: translateY(8px); opacity: 0; } to { transform: none; opacity: 1; } } }
  `;

  const LEVEL_WORDS = { MEDIUM: "Medium risk", HIGH: "High risk", CRITICAL: "Critical risk" };

  function removeWarning() {
    if (warnHost && warnHost.parentNode) warnHost.parentNode.removeChild(warnHost);
    warnHost = null;
  }

  function showWarning(reply) {
    if (warnHost || warnDismissed || !isActive()) return;
    warnHost = document.createElement("div");
    warnHost.id = "prevenza-warning-host";
    const root = warnHost.attachShadow({ mode: "open" });
    applyStyles(root, WARN_STYLE);

    const veil = document.createElement("div");
    veil.className = "veil";
    const box = document.createElement("div");
    box.className = "box";
    box.setAttribute("role", "alertdialog");
    box.setAttribute("aria-modal", "true");
    box.setAttribute("aria-labelledby", "pz-warn-title");
    box.setAttribute("aria-describedby", "pz-warn-why");
    box.setAttribute("data-elder", settings && settings.elderMode ? "true" : "false");

    const head = document.createElement("div");
    head.className = "head";
    head.appendChild(H.mascotElement(document, 48));
    const title = document.createElement("h2");
    title.id = "pz-warn-title";
    title.textContent = "Stop and check: this website may be a scam";
    head.appendChild(title);

    const site = document.createElement("p");
    site.className = "host";
    site.textContent = typeof reply.host === "string" && reply.host ? reply.host : hostname;
    const pill = document.createElement("span");
    pill.className = "pill";
    pill.setAttribute("data-level", reply.category);
    pill.textContent = LEVEL_WORDS[reply.category] || "Warning";

    const why = document.createElement("p");
    why.id = "pz-warn-why";
    why.textContent = "Prevenza checked only the name of this website, and it has warning signs:";
    const list = document.createElement("ul");
    (Array.isArray(reply.reasons) ? reply.reasons : []).slice(0, 3).forEach((r) => {
      const li = document.createElement("li");
      li.textContent = String(r);
      list.appendChild(li);
    });
    const advice = document.createElement("p");
    advice.textContent = "Do not type personal or bank details on this page. If a message sent you here, open the company's own app or type its address yourself.";
    const note = document.createElement("p");
    note.className = "note";
    note.textContent = "This is a warning, not a certainty. If you trust this website, you can continue. To stop warnings here, add it to Quiet sites in Prevenza's settings.";

    const row = document.createElement("div");
    row.className = "row";
    const back = document.createElement("button");
    back.type = "button";
    back.className = "back";
    back.textContent = "Go back";
    back.addEventListener("click", () => {
      history.back();
      note.textContent = "If nothing changed, close this tab.";
    });
    const go = document.createElement("button");
    go.type = "button";
    go.className = "go";
    go.textContent = "Continue anyway";
    go.addEventListener("click", () => {
      warnDismissed = true;
      removeWarning();
    });
    row.append(back, go);

    box.append(head, site, pill, why, list, advice, note, row);
    veil.appendChild(box);
    root.appendChild(veil);
    document.documentElement.appendChild(warnHost);
    back.focus();
  }

  // Ask once per page, and only when warnings are on and the site is not on the quiet list.
  function checkPage() {
    if (warnAsked || !isActive() || !settings.pageWarnings) return;
    warnAsked = true;
    send({ type: MSG.CHECK_PAGE, payload: { hostname, protocol: location.protocol } }).then((reply) => {
      if (reply && reply.ok && reply.warn === true) showWarning(reply);
    });
  }

  function applyStyles(root, css) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css || STYLE);
      root.adoptedStyleSheets = [sheet]; // constructable stylesheets are not blocked by a page's CSP
    } catch (e) {
      const el = document.createElement("style");
      el.textContent = css || STYLE;
      root.appendChild(el);
    }
  }

  function build() {
    host = document.createElement("div");
    host.id = "prevenza-assistant-host";
    shadow = host.attachShadow({ mode: "open" });
    applyStyles(shadow);

    const wrap = document.createElement("div");
    wrap.className = "wrap";

    bubbleEl = document.createElement("div");
    bubbleEl.className = "bubble";
    bubbleEl.setAttribute("role", "status");
    bubbleEl.hidden = true;
    const row = document.createElement("div");
    row.className = "row";
    row.appendChild(H.mascotElement(document, 36));
    const body = document.createElement("div");
    const title = document.createElement("p");
    title.className = "title";
    title.textContent = "Hi, I'm Prevy.";
    const text = document.createElement("p");
    text.className = "text";
    text.textContent = "I'm your Prevenza assistant. Scam checking isn't switched on yet, but I'm ready to help.";
    body.append(title, text);
    const close = document.createElement("button");
    close.className = "close";
    close.type = "button";
    close.setAttribute("aria-label", "Close");
    close.textContent = "\u00D7";
    close.addEventListener("click", () => hideBubble());
    row.append(body, close);
    bubbleEl.appendChild(row);

    badgeEl = document.createElement("button");
    badgeEl.className = "badge";
    badgeEl.type = "button";
    badgeEl.setAttribute("aria-label", "Prevenza assistant");
    badgeEl.appendChild(H.mascotElement(document, 30));
    badgeEl.addEventListener("click", () => (bubbleEl.hidden ? showBubble() : hideBubble()));

    wrap.append(bubbleEl, badgeEl);
    shadow.appendChild(wrap);
    document.documentElement.appendChild(host);
  }

  function destroy() {
    clearTimeout(bubbleTimer);
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = shadow = badgeEl = bubbleEl = null;
  }

  // Show only what is needed. If nothing should be visible, the page is left completely untouched.
  function render() {
    const wantBadge = isActive() && settings.showAssistantBadge;
    const bubbleOpen = !!bubbleEl && !bubbleEl.hidden && isActive();
    if (!wantBadge && !bubbleOpen) {
      destroy();
      return;
    }
    if (!host) build();
    badgeEl.hidden = !wantBadge;
    bubbleEl.setAttribute("data-elder", settings.elderMode ? "true" : "false");
    host.setAttribute("data-badge", wantBadge ? "visible" : "hidden");
    host.setAttribute("data-bubble", bubbleEl.hidden ? "closed" : "open");
  }

  function showBubble() {
    if (!isActive()) return false;
    if (!host) build();
    bubbleEl.hidden = false;
    render();
    clearTimeout(bubbleTimer);
    bubbleTimer = setTimeout(hideBubble, PREVIEW_MS);
    return true;
  }

  function hideBubble() {
    clearTimeout(bubbleTimer);
    if (bubbleEl) bubbleEl.hidden = true;
    render();
  }

  function send(message) {
    try {
      return chrome.runtime.sendMessage(message).catch(() => null);
    } catch (e) {
      return Promise.resolve(null); // extension was reloaded; this page's script is orphaned
    }
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!sender || sender.id !== chrome.runtime.id) return; // ignore anything not from our own extension
    if (!message || typeof message.type !== "string") return;

    switch (message.type) {
      case MSG.GET_TAB_STATUS:
        sendResponse({
          ok: true,
          hostname,
          protocol: location.protocol,
          ready: settings !== null,
          enabled: !!settings && settings.enabled,
          muted: isMuted(),
          badgeVisible: !!host && host.getAttribute("data-badge") === "visible",
          warningVisible: !!warnHost,
        });
        break;

      case MSG.PREVIEW_ASSISTANT:
        sendResponse({ ok: true, shown: showBubble() });
        break;

      case MSG.SETTINGS_UPDATED:
        if (message.payload && message.payload.settings) {
          settings = H.sanitizeSettings(message.payload.settings);
          render();
          if (!isActive() || !settings.pageWarnings) removeWarning();
          else checkPage();
        }
        sendResponse({ ok: true });
        break;

      default:
        break;
    }
  });

  // Tell the background worker this page is open, and learn the current settings.
  send({ type: MSG.CONTENT_READY }).then((reply) => {
    if (reply && reply.ok && reply.settings) {
      settings = H.sanitizeSettings(reply.settings);
      render();
      checkPage();
    }
  });
})();

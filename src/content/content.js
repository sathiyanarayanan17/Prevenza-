/*
 * Prevenza: content script.
 *
 * PRIVACY CONTRACT (enforced by test/security.test.js):
 *   - reads only location.hostname and location.protocol
 *   - never reads form fields, passwords, cookies, page text or storage of the page
 *   - never listens to keyboard, input or paste events
 *   - never talks to the network; it only talks to this extension's background worker
 *   - silent by default: it adds nothing to the page unless the user turns the assistant badge on
 *     or asks for a preview from the popup
 * Scam detection is not part of this step.
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

  function applyStyles(root) {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      root.adoptedStyleSheets = [sheet]; // constructable stylesheets are not blocked by a page's CSP
    } catch (e) {
      const el = document.createElement("style");
      el.textContent = STYLE;
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
        });
        break;

      case MSG.PREVIEW_ASSISTANT:
        sendResponse({ ok: true, shown: showBubble() });
        break;

      case MSG.SETTINGS_UPDATED:
        if (message.payload && message.payload.settings) {
          settings = H.sanitizeSettings(message.payload.settings);
          render();
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
    }
  });
})();

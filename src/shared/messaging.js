/*
 * Prevenza: helpers for extension pages (popup, settings, dashboard).
 * Every call returns a plain { ok, ... } object and never throws, so the UI can always show a friendly message.
 */
(function () {
  "use strict";
  const H = (self.Prevenza = self.Prevenza || {});

  function withTimeout(promise, ms) {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve({ ok: false, error: "timeout" }), ms);
      promise.then(
        (value) => {
          clearTimeout(timer);
          resolve(value || { ok: false, error: "no-response" });
        },
        (err) => {
          clearTimeout(timer);
          resolve({ ok: false, error: String((err && err.message) || err) });
        }
      );
    });
  }

  /** Page -> background worker. */
  function send(message, timeoutMs) {
    try {
      return withTimeout(chrome.runtime.sendMessage(message), timeoutMs || 4000);
    } catch (e) {
      return Promise.resolve({ ok: false, error: "extension-unavailable" });
    }
  }

  /** Page -> content script in the tab the user is looking at. */
  async function sendToActiveTab(message, timeoutMs) {
    try {
      const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
      const tab = tabs && tabs[0];
      if (!tab || typeof tab.id !== "number") return { ok: false, error: "no-active-tab" };
      const reply = await withTimeout(chrome.tabs.sendMessage(tab.id, message), timeoutMs || 2500);
      return reply.ok === false && /Receiving end|Could not establish/i.test(String(reply.error))
        ? { ok: false, error: "no-content-script" }
        : reply;
    } catch (e) {
      return { ok: false, error: "no-content-script" };
    }
  }

  /** Page -> content script in every open tab. Used by the dashboard system check. */
  async function sendToAllTabs(message, timeoutMs) {
    let tabs = [];
    try {
      tabs = await chrome.tabs.query({});
    } catch (e) {
      return [];
    }
    const replies = await Promise.all(
      tabs
        .filter((t) => typeof t.id === "number")
        .map((t) => withTimeout(chrome.tabs.sendMessage(t.id, message), timeoutMs || 1500))
    );
    return replies.filter((r) => r && r.ok === true);
  }

  H.messaging = { send, sendToActiveTab, sendToAllTabs };
})();

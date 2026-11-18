/*
 * Prevenza website and app: replaces src/shared/messaging.js.
 *
 * Extension pages send every request to a background worker. A website has no background worker, so the SAME router
 * (src/background/handler.js) runs inside this page, with the same payload checks and the same detection modules.
 * Nothing leaves the page: there is no network code here, and the page's security policy has connect-src 'none'.
 *
 * Storage: the browser's localStorage, through the same createStore() the extension uses, so only settings and counters
 * can be written (createStore sanitizes both). Links, messages, payment details and screenshot text are never stored.
 * If the browser blocks localStorage (for example some private windows), settings live in this page's memory only.
 *
 * Load after: constants, settings, storage, background/handler, and (optionally) the detection modules. A page that
 * does not load a detector, such as Emergency Help, gets the router's normal "unavailable" reply for that check.
 */
(function () {
  "use strict";
  const H = (self.Prevenza = self.Prevenza || {});

  const PAGE_ID = "prevenza-web";
  const VERSION = "0.1.0";
  const KEY_PREFIX = "prevenza-web:";

  // The router checks who sent each message, because in Chrome other extensions and web pages can try to talk to it.
  // On the website the only caller is this page's own code, so every request is sent as an extension page would be.
  const SELF = Object.freeze({ id: PAGE_ID, url: "chrome-extension://" + PAGE_ID + "/web/" });

  /** A chrome.storage.local look-alike (get, set, remove) over localStorage, with an in-memory fallback. */
  function createLocalArea(backend) {
    let ls = backend === undefined ? null : backend;
    if (backend === undefined) {
      try {
        ls = self.localStorage;
        ls.getItem(KEY_PREFIX + "probe");
      } catch (e) {
        ls = null;
      }
    }
    const memory = new Map();

    function readRaw(key) {
      if (ls) {
        try {
          return ls.getItem(KEY_PREFIX + key);
        } catch (e) {
          ls = null;
        }
      }
      return memory.has(key) ? memory.get(key) : null;
    }

    function writeRaw(key, value) {
      if (ls) {
        try {
          ls.setItem(KEY_PREFIX + key, value);
          return;
        } catch (e) {
          ls = null; // full or blocked: keep working in memory for the rest of this visit
        }
      }
      memory.set(key, value);
    }

    function removeRaw(key) {
      memory.delete(key);
      if (ls) {
        try {
          ls.removeItem(KEY_PREFIX + key);
        } catch (e) {
          ls = null;
        }
      }
    }

    return {
      async get(key) {
        const raw = readRaw(key);
        if (raw === null) return {};
        try {
          return { [key]: JSON.parse(raw) };
        } catch (e) {
          return {}; // damaged value: the store falls back to defaults
        }
      },
      async set(items) {
        for (const key of Object.keys(items)) writeRaw(key, JSON.stringify(items[key]));
      },
      async remove(key) {
        removeRaw(key);
      },
      persistent: () => ls !== null,
    };
  }

  const area = createLocalArea();
  const store = H.createStore(area);
  const background = H.createBackground({
    store,
    runtimeId: PAGE_ID,
    version: VERSION,
    urlIntel: H.urlIntel,
    messageScan: H.messageScan,
    riskEngine: H.riskEngine,
    upiAnalyze: H.upiAnalyze,
    screenshot: H.screenshot,
  });
  const ready = store.init().catch(() => undefined);

  /** Same contract as the extension's messaging.send: always resolves to { ok, ... }, never throws. */
  function send(message) {
    return ready
      .then(() => background.handle(message, SELF))
      .then(
        (reply) => reply || { ok: false, error: "no-response" },
        () => ({ ok: false, error: "internal-error" })
      );
  }

  // There are no browser tabs to talk to on a website.
  const sendToActiveTab = async () => ({ ok: false, error: "no-content-script" });
  const sendToAllTabs = async () => [];

  H.messaging = { send, sendToActiveTab, sendToAllTabs };
  H.web = { version: VERSION, storageIsPersistent: area.persistent, createLocalArea };
})();

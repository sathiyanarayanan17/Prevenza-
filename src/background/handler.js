/*
 * Prevenza: background message router. Pure logic with injected dependencies so it can be unit tested.
 *
 * Who may send what:
 *   - extension pages (popup, settings, dashboard): everything except CONTENT_READY
 *   - content scripts: PING and CONTENT_READY only
 *   - anything else (other extensions, unknown senders): rejected
 * Every reply has the shape { ok: true, ... } or { ok: false, error: "..." }.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const deps = isNode
    ? Object.assign({}, require("../shared/constants.js"), require("../shared/settings.js"))
    : root.Prevenza;
  const api = factory(deps);
  if (isNode) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    Object.assign(root.Prevenza, api);
  }
})(typeof self !== "undefined" ? self : this, function (H) {
  const MSG = H.MSG;

  // Which kinds of sender may use each message type.
  const POLICY = Object.freeze({
    [MSG.PING]: ["page", "content"],
    [MSG.GET_STATE]: ["page"],
    [MSG.UPDATE_SETTINGS]: ["page"],
    [MSG.RESET_STATS]: ["page"],
    [MSG.RESET_SETTINGS]: ["page"],
    [MSG.DIAGNOSTICS]: ["page"],
    [MSG.CONTENT_READY]: ["content"],
  });

  /**
   * deps: {
   *   store:      createStore(...)
   *   runtimeId:  chrome.runtime.id
   *   version:    manifest version string
   *   broadcast:  async (message) => void   sends a message to every tab's content script
   *   now:        () => number               optional, for tests
   * }
   */
  function createBackground(deps) {
    const { store, runtimeId, version } = deps;
    const broadcast = deps.broadcast || (async () => undefined);
    const now = deps.now || (() => Date.now());
    const extOrigin = "chrome-extension://" + runtimeId + "/";

    function classifySender(sender) {
      if (!sender || sender.id !== runtimeId) return "foreign";
      if (typeof sender.url === "string" && sender.url.startsWith(extOrigin)) return "page";
      if (sender.tab) return "content";
      return "foreign";
    }

    async function handle(message, sender) {
      if (!H.isPlainObject(message) || typeof message.type !== "string") return { ok: false, error: "bad-message" };
      const allowed = POLICY[message.type];
      if (!allowed) return { ok: false, error: "unknown-type" };
      const kind = classifySender(sender);
      if (!allowed.includes(kind)) return { ok: false, error: "not-allowed" };

      switch (message.type) {
        case MSG.PING:
          return { ok: true, pong: true, version, time: now() };

        case MSG.GET_STATE:
          return { ok: true, version, settings: await store.getSettings(), stats: await store.getStats() };

        case MSG.CONTENT_READY: {
          const settings = await store.getSettings();
          if (settings.enabled) await store.recordPageSeen();
          return { ok: true, settings };
        }

        case MSG.UPDATE_SETTINGS: {
          const payload = message.payload;
          if (!H.isPlainObject(payload) || !H.isPlainObject(payload.settings)) return { ok: false, error: "bad-payload" };
          const settings = await store.saveSettings(payload.settings);
          await broadcast({ type: MSG.SETTINGS_UPDATED, payload: { settings } });
          return { ok: true, settings };
        }

        case MSG.RESET_SETTINGS: {
          const settings = await store.resetSettings();
          await broadcast({ type: MSG.SETTINGS_UPDATED, payload: { settings } });
          return { ok: true, settings };
        }

        case MSG.RESET_STATS:
          return { ok: true, stats: await store.resetStats() };

        case MSG.DIAGNOSTICS: {
          const started = now();
          const storageOk = await store.selfTest();
          return { ok: true, version, storageOk, workerTime: now() - started };
        }

        default:
          return { ok: false, error: "unknown-type" };
      }
    }

    return { handle, classifySender };
  }

  return { createBackground, MESSAGE_POLICY: POLICY };
});

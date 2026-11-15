/*
 * Prevenza: shared constants. Loaded by the service worker, the content script and every extension page.
 * Works in the browser (as self.Prevenza) and in Node (module.exports) so it can be unit tested.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    Object.assign(root.Prevenza, api);
  }
})(typeof self !== "undefined" ? self : this, function () {
  const BRAND = Object.freeze({
    name: "Prevenza",
    fullName: "Prevenza: Scam Guard",
    tagline: "Pause. Check. Stay safe.",
    assistant: "Prevy",
  });

  // Every message between popup, settings, dashboard, background and content script uses one of these.
  const MSG = Object.freeze({
    PING: "prevenza/ping",
    GET_STATE: "prevenza/get-state",
    UPDATE_SETTINGS: "prevenza/update-settings",
    RESET_STATS: "prevenza/reset-stats",
    RESET_SETTINGS: "prevenza/reset-settings",
    DIAGNOSTICS: "prevenza/diagnostics",
    CONTENT_READY: "prevenza/content-ready", // content script -> background
    GET_TAB_STATUS: "prevenza/get-tab-status", // popup/dashboard -> content script
    PREVIEW_ASSISTANT: "prevenza/preview-assistant", // popup -> content script
    SETTINGS_UPDATED: "prevenza/settings-updated", // background -> content scripts
  });

  const STORAGE_KEYS = Object.freeze({
    settings: "prevenza.settings",
    stats: "prevenza.stats",
    schema: "prevenza.schema",
    selfTest: "prevenza.selftest",
  });

  const SCHEMA_VERSION = 1;

  const LANGUAGES = Object.freeze([
    Object.freeze({ id: "en", label: "English" }),
    Object.freeze({ id: "hi", label: "\u0939\u093F\u0928\u094D\u0926\u0940 (Hindi)" }),
    Object.freeze({ id: "ta", label: "\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD (Tamil)" }),
  ]);

  const SENSITIVITY = Object.freeze([
    Object.freeze({ id: "relaxed", label: "Relaxed", help: "Only the clearest scams. Fewest interruptions." }),
    Object.freeze({ id: "balanced", label: "Balanced", help: "A sensible middle. Recommended." }),
    Object.freeze({ id: "strict", label: "Strict", help: "Warns early. More interruptions." }),
  ]);

  // The risk scale the interface uses. Step 1 never assigns a level other than "unknown".
  const RISK_LEVELS = Object.freeze([
    Object.freeze({ id: "unknown", label: "Not scanned yet", help: "Prevenza has not checked this page." }),
    Object.freeze({ id: "safe", label: "Looks safe", help: "No warning signs found." }),
    Object.freeze({ id: "caution", label: "Be careful", help: "Some warning signs. Double-check." }),
    Object.freeze({ id: "danger", label: "Likely scam", help: "Strong warning signs. Do not pay." }),
  ]);

  const DEFAULT_SETTINGS = Object.freeze({
    enabled: true,
    elderMode: false,
    language: "en",
    sensitivity: "balanced",
    showAssistantBadge: false, // silent by default: the assistant never appears unless asked
    mutedSites: Object.freeze([]),
  });

  const LIMITS = Object.freeze({ maxMutedSites: 200, maxCounter: 1000000000 });

  return { BRAND, MSG, STORAGE_KEYS, SCHEMA_VERSION, LANGUAGES, SENSITIVITY, RISK_LEVELS, DEFAULT_SETTINGS, LIMITS };
});

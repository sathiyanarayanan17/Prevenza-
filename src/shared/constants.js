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
    ANALYZE_SITE: "prevenza/analyze-site", // popup -> background: site name + protocol of the open tab
    CHECK_URL: "prevenza/check-url", // dashboard -> background: an address the user typed or pasted
    SCAN_MESSAGE: "prevenza/scan-message", // dashboard -> background: text the user pasted into the message checker
    ANALYZE_UPI: "prevenza/analyze-upi", // dashboard -> background: payment details the user typed into the UPI analyzer
    ANALYZE_SCREENSHOT: "prevenza/analyze-screenshot", // dashboard -> background: text that OCR read from a screenshot the user chose
  });

  // The screenshot analyzer accepts only the text that was read (never the image) and the reader's own confidence score.
  const SCREENSHOT_LIMITS = Object.freeze({ maxInput: 20000 });

  // The UPI analyzer accepts only these fields, each as text, with these length limits.
  const UPI_LIMITS = Object.freeze({ upiId: 100, name: 100, amount: 40, reason: 1000, qrText: 1000 });

  // Choices in the message checker. "auto" lets Prevenza guess. Hinglish means Hindi written in English letters.
  const SCAN_LANGUAGES = Object.freeze([
    Object.freeze({ id: "auto", label: "Detect automatically" }),
    Object.freeze({ id: "en", label: "English" }),
    Object.freeze({ id: "hi", label: "\u0939\u093F\u0928\u094D\u0926\u0940 (Hindi)" }),
    Object.freeze({ id: "ta", label: "\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD (Tamil)" }),
    Object.freeze({ id: "hinglish", label: "Hinglish (Hindi in English letters)" }),
  ]);

  // The message checker refuses anything longer than maxInput, and only analyses the first maxAnalysed characters.
  const MESSAGE_LIMITS = Object.freeze({ maxInput: 20000, maxAnalysed: 5000 });

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

  // The risk scale the interface shows. "pill" is the style name. Results from the URL checker use low / medium / high.
  const RISK_LEVELS = Object.freeze([
    Object.freeze({ id: "unknown", pill: "unknown", label: "Not scanned yet", help: "Prevenza has not checked this page." }),
    Object.freeze({ id: "low", pill: "low", label: "Low risk", help: "No strong warning signs in the address. This is not a guarantee." }),
    Object.freeze({ id: "medium", pill: "caution", label: "Medium risk", help: "Some unusual signs. Check carefully." }),
    Object.freeze({ id: "high", pill: "danger", label: "High risk", help: "Strong warning signs. Do not pay." }),
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

  return { BRAND, MSG, STORAGE_KEYS, SCHEMA_VERSION, LANGUAGES, SCAN_LANGUAGES, MESSAGE_LIMITS, UPI_LIMITS, SCREENSHOT_LIMITS, SENSITIVITY, RISK_LEVELS, DEFAULT_SETTINGS, LIMITS };
});

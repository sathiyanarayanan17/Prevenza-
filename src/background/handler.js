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
    [MSG.ANALYZE_SITE]: ["page"],
    [MSG.CHECK_URL]: ["page"],
    [MSG.SCAN_MESSAGE]: ["page"],
    [MSG.ANALYZE_UPI]: ["page"],
    [MSG.ANALYZE_SCREENSHOT]: ["page"],
    [MSG.CONTENT_READY]: ["content"],
  });

  // URL analysis accepts only the exact fields below. A path, query or page text is refused at the door.
  const SITE_FIELDS = ["hostname", "protocol"];
  const URL_FIELDS = ["url"];
  // The message checker accepts text the user pasted, and optionally a language choice. Nothing else.
  const MESSAGE_FIELDS = ["text", "language"];
  // The UPI analyzer accepts text fields only, never a PIN, an OTP or anything else.
  const UPI_FIELDS = ["upiId", "name", "amount", "reason", "qrText"];
  // The screenshot analyzer accepts the text that was read, a language choice and the reader's confidence. Never the image.
  const SHOT_FIELDS = ["text", "language", "confidence"];
  const MAX_URL_INPUT = 2048;
  const MAX_HOSTNAME_INPUT = 253;

  function hasOnlyKeys(obj, allowed) {
    const keys = Object.keys(obj);
    return keys.length === allowed.length && allowed.every((k) => keys.includes(k));
  }

  /**
   * deps: {
   *   store:      createStore(...)
   *   runtimeId:  chrome.runtime.id
   *   version:    manifest version string
   *   broadcast:  async (message) => void   sends a message to every tab's content script
   *   urlIntel:   the offline URL analyzer (optional; without it URL messages reply "unavailable")
   *   messageScan: the offline message scanner (optional; without it message checks reply "unavailable")
   *   riskEngine: the central risk engine (optional; needed together with messageScan)
   *   now:        () => number               optional, for tests
   * }
   */
  function createBackground(deps) {
    const { store, runtimeId, version } = deps;
    const urlIntel = deps.urlIntel || null;
    const messageScan = deps.messageScan || null;
    const riskEngine = deps.riskEngine || null;
    const upiAnalyze = deps.upiAnalyze || null;
    const screenshot = deps.screenshot || null;
    const broadcast = deps.broadcast || (async () => undefined);
    const now = deps.now || (() => Date.now());
    const extOrigin = "chrome-extension://" + runtimeId + "/";

    /**
     * Web addresses written inside a pasted message go through the same offline URL checker, in memory only.
     * Returns the evidence in the shape the risk engine expects, or undefined if there was nothing to check.
     */
    function linkEvidence(text) {
      if (!urlIntel || !messageScan) return { module: undefined, checked: 0 };
      const indicators = [];
      let checked = 0;
      for (const link of messageScan.extractLinks(text)) {
        const r = urlIntel.analyzeUrl(link);
        if (!r || r.ok !== true || !Array.isArray(r.indicators)) continue;
        checked += 1;
        for (const i of r.indicators) indicators.push({ id: i.id, label: i.label, why: i.why, weight: i.weight, severity: i.severity, critical: i.critical === true });
      }
      return checked > 0 ? { module: { ok: true, indicators }, checked } : { module: undefined, checked: 0 };
    }

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

        // Automatic scan of the open tab. Receives the site name and protocol only.
        case MSG.ANALYZE_SITE: {
          const p = message.payload;
          if (!H.isPlainObject(p) || !hasOnlyKeys(p, SITE_FIELDS)) return { ok: false, error: "bad-payload" };
          if (typeof p.hostname !== "string" || p.hostname.length === 0 || p.hostname.length > MAX_HOSTNAME_INPUT) return { ok: false, error: "bad-payload" };
          if (p.protocol !== "http:" && p.protocol !== "https:") return { ok: false, error: "bad-payload" };
          if (!urlIntel) return { ok: false, error: "unavailable" };
          const settings = await store.getSettings();
          if (!settings.enabled) return { ok: true, skipped: "protection-off" };
          if (H.isMuted(p.hostname, settings.mutedSites)) return { ok: true, skipped: "quiet-site" };
          return { ok: true, result: urlIntel.analyzeSite({ hostname: p.hostname, protocol: p.protocol }) };
        }

        // The user typed or pasted this address into the link checker. Nothing is stored.
        case MSG.CHECK_URL: {
          const p = message.payload;
          if (!H.isPlainObject(p) || !hasOnlyKeys(p, URL_FIELDS)) return { ok: false, error: "bad-payload" };
          if (typeof p.url !== "string" || p.url.length > MAX_URL_INPUT) return { ok: false, error: "bad-payload" };
          if (!urlIntel) return { ok: false, error: "unavailable" };
          const settings = await store.getSettings();
          if (!settings.enabled) return { ok: true, skipped: "protection-off" };
          const result = urlIntel.analyzeUrl(p.url);
          // A site on the quiet list is still checked when the user asks directly; the answer says so.
          const quiet = result.ok && H.isMuted(result.host, settings.mutedSites);
          return { ok: true, result, quietSite: !!quiet };
        }

        // The user pasted this text into the message checker. It is analysed in memory and never stored.
        // The reply carries rule wording, character positions and the risk assessment, never a copy of the text.
        case MSG.SCAN_MESSAGE: {
          const p = message.payload;
          if (!H.isPlainObject(p) || typeof p.text !== "string" || p.text.length > H.MESSAGE_LIMITS.maxInput) return { ok: false, error: "bad-payload" };
          if (!Object.keys(p).every((k) => MESSAGE_FIELDS.includes(k))) return { ok: false, error: "bad-payload" };
          if (p.language !== undefined && !H.SCAN_LANGUAGES.some((l) => l.id === p.language)) return { ok: false, error: "bad-payload" };
          if (!messageScan || !riskEngine) return { ok: false, error: "unavailable" };
          const settings = await store.getSettings();
          if (!settings.enabled) return { ok: true, skipped: "protection-off" };
          const scan = messageScan.scanMessage(p.text, { language: p.language || "auto" });
          if (!scan.ok) return { ok: true, result: { ok: false, error: scan.error, message: scan.message } };
          const links = linkEvidence(p.text);
          const assessment = riskEngine.assess({ message: { ok: true, indicators: scan.indicators }, url: links.module });
          return {
            ok: true,
            result: {
              ok: true,
              assessment,
              language: scan.language,
              languageNote: scan.languageNote,
              highlights: scan.highlights,
              primaryCategory: scan.primaryCategory,
              otherCategories: scan.otherCategories,
              truncated: scan.truncated,
              analysedLength: scan.analysedLength,
              shortText: scan.shortText,
              linksChecked: links.checked,
            },
          };
        }

        // The user typed these payment details into the UPI analyzer. Analysed in memory, never stored, never echoed back
        // except the recipient, name and amount read from a pasted code (so the page can show what the code contains).
        case MSG.ANALYZE_UPI: {
          const p = message.payload;
          if (!H.isPlainObject(p) || !Object.keys(p).every((k) => UPI_FIELDS.includes(k))) return { ok: false, error: "bad-payload" };
          for (const k of Object.keys(p)) if (typeof p[k] !== "string" || p[k].length > H.UPI_LIMITS[k]) return { ok: false, error: "bad-payload" };
          if (!messageScan || !riskEngine || !upiAnalyze) return { ok: false, error: "unavailable" };
          const settings = await store.getSettings();
          if (!settings.enabled) return { ok: true, skipped: "protection-off" };
          const upi = upiAnalyze.analyzeUpi(p, { messageScan });
          if (!upi.ok) return { ok: true, result: { ok: false, error: upi.error, message: upi.message, problems: upi.problems } };
          const links = linkEvidence(upi.linkText);
          const assessment = riskEngine.assess({ payment: { ok: true, indicators: upi.indicators }, url: links.module });
          return {
            ok: true,
            result: {
              ok: true,
              assessment,
              warning: upiAnalyze.holdyWarning(assessment),
              problems: upi.problems,
              notes: upi.notes,
              qr: upi.qr,
              checked: upi.checked,
              linksChecked: links.checked,
              cannotStop: upiAnalyze.CANNOT_STOP,
            },
          };
        }

        // Text that OCR read from a screenshot the user chose. The image itself never reaches the background worker.
        // Analysed in memory and never stored. Poor or empty reading is reported as "could not tell", never as safe.
        case MSG.ANALYZE_SCREENSHOT: {
          const p = message.payload;
          if (!H.isPlainObject(p) || !Object.keys(p).every((k) => SHOT_FIELDS.includes(k))) return { ok: false, error: "bad-payload" };
          if (typeof p.text !== "string" || p.text.length > H.SCREENSHOT_LIMITS.maxInput) return { ok: false, error: "bad-payload" };
          if (p.language !== undefined && !H.SCAN_LANGUAGES.some((l) => l.id === p.language)) return { ok: false, error: "bad-payload" };
          if (p.confidence !== undefined && p.confidence !== null && !(typeof p.confidence === "number" && Number.isFinite(p.confidence) && p.confidence >= 0 && p.confidence <= 100)) {
            return { ok: false, error: "bad-payload" };
          }
          if (!messageScan || !riskEngine || !screenshot) return { ok: false, error: "unavailable" };
          const settings = await store.getSettings();
          if (!settings.enabled) return { ok: true, skipped: "protection-off" };

          const quality = screenshot.assessOcrQuality({ text: p.text, confidence: p.confidence === undefined ? null : p.confidence });
          if (quality.level === "none") {
            const assessment = riskEngine.assess({ screenshot: { unavailable: true, reason: "No readable text was found in the image." } });
            return { ok: true, result: { ok: true, readable: false, quality, assessment, receipt: null } };
          }
          const scan = messageScan.scanMessage(p.text, { language: p.language || "auto", screenshot: true });
          if (!scan.ok) return { ok: true, result: { ok: false, error: scan.error, message: scan.message } };
          const receipt = screenshot.receiptFacts(p.text);
          const hasWarning = scan.indicators.some((i) => i.weight > 0);
          let assessment;
          let links = { module: undefined, checked: 0 };
          if (quality.level === "poor" && !hasWarning) {
            assessment = riskEngine.assess({ screenshot: { unavailable: true, reason: "The text in the image was too hard to read to tell." } });
          } else {
            links = linkEvidence(p.text);
            assessment = riskEngine.assess({ screenshot: { ok: true, indicators: scan.indicators }, url: links.module });
          }
          const releaseGoods = scan.indicators.some((i) => i.id === "msg_release_goods_request");
          return {
            ok: true,
            result: {
              ok: true,
              readable: true,
              quality,
              assessment,
              language: scan.language,
              languageNote: scan.languageNote,
              highlights: scan.highlights,
              primaryCategory: scan.primaryCategory,
              otherCategories: scan.otherCategories,
              truncated: scan.truncated,
              analysedLength: scan.analysedLength,
              receipt,
              receiptWarning: receipt.looksLikeReceipt || releaseGoods ? { text: screenshot.RECEIPT_WARNING, caveat: screenshot.RECEIPT_CAVEAT } : null,
              linksChecked: links.checked,
            },
          };
        }

        default:
          return { ok: false, error: "unknown-type" };
      }
    }

    return { handle, classifySender };
  }

  return { createBackground, MESSAGE_POLICY: POLICY };
});

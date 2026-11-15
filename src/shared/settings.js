/*
 * Prevenza: settings and stats validation. Pure functions, no browser APIs.
 * Anything that is not recognised is dropped, so corrupted or hostile data can never reach the UI.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const deps = isNode ? require("./constants.js") : root.Prevenza;
  const api = factory(deps);
  if (isNode) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    Object.assign(root.Prevenza, api);
  }
})(typeof self !== "undefined" ? self : this, function (C) {
  const HOSTNAME_RE = /^(?=.{1,253}$)[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?(\.[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?)*$/;

  function isPlainObject(v) {
    return v !== null && typeof v === "object" && !Array.isArray(v);
  }

  /** "https://www.Example.com:8080/path" -> "example.com". Returns null if it is not a valid hostname. */
  function normalizeHostname(value) {
    if (typeof value !== "string") return null;
    let h = value.trim().toLowerCase();
    h = h.replace(/^[a-z][a-z0-9+.-]*:\/\//, "").replace(/[/?#].*$/, "").replace(/:\d+$/, "").replace(/^www\./, "");
    return HOSTNAME_RE.test(h) ? h : null;
  }

  /** True if hostname equals a muted site or is a subdomain of one. */
  function isMuted(hostname, mutedSites) {
    const h = normalizeHostname(hostname);
    if (!h || !Array.isArray(mutedSites)) return false;
    return mutedSites.some((m) => h === m || h.endsWith("." + m));
  }

  function sanitizeSettings(input) {
    const src = isPlainObject(input) ? input : {};
    const d = C.DEFAULT_SETTINGS;
    const seen = new Set();
    const muted = [];
    if (Array.isArray(src.mutedSites)) {
      for (const raw of src.mutedSites) {
        const h = normalizeHostname(raw);
        if (h && !seen.has(h)) {
          seen.add(h);
          muted.push(h);
          if (muted.length >= C.LIMITS.maxMutedSites) break;
        }
      }
    }
    return {
      enabled: typeof src.enabled === "boolean" ? src.enabled : d.enabled,
      elderMode: typeof src.elderMode === "boolean" ? src.elderMode : d.elderMode,
      language: C.LANGUAGES.some((l) => l.id === src.language) ? src.language : d.language,
      sensitivity: C.SENSITIVITY.some((s) => s.id === src.sensitivity) ? src.sensitivity : d.sensitivity,
      showAssistantBadge: typeof src.showAssistantBadge === "boolean" ? src.showAssistantBadge : d.showAssistantBadge,
      mutedSites: muted,
    };
  }

  function counter(v) {
    return Number.isInteger(v) && v >= 0 ? Math.min(v, C.LIMITS.maxCounter) : 0;
  }

  function isoOrNull(v) {
    if (typeof v !== "string" || v.length > 40) return null;
    const t = Date.parse(v);
    return Number.isNaN(t) ? null : new Date(t).toISOString();
  }

  // Stats are counters and timestamps only. No URLs, no page text, no personal data.
  function sanitizeStats(input) {
    const src = isPlainObject(input) ? input : {};
    return {
      pagesSeen: counter(src.pagesSeen),
      warningsShown: counter(src.warningsShown),
      installedAt: isoOrNull(src.installedAt),
      lastActiveAt: isoOrNull(src.lastActiveAt),
    };
  }

  return { isPlainObject, normalizeHostname, isMuted, sanitizeSettings, sanitizeStats };
});

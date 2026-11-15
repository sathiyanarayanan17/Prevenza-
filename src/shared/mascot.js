/*
 * Prevy, the Prevenza assistant. An original character (a shield with a friendly, slightly worried face).
 * Shared by the content script and the extension pages. Exposed as markup strings, parsed with DOMParser
 * so no innerHTML is ever used.
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
  const SVG_NS = "http://www.w3.org/2000/svg";

  const INNER =
    '<path d="M60 5C74 15 92 20 108 20V62C108 92 88 112 60 125C32 112 12 92 12 62V20C28 20 46 15 60 5Z" fill="#3b82f6" stroke="#93c5fd" stroke-width="3" stroke-linejoin="round"/>' +
    '<ellipse cx="60" cy="62" rx="37" ry="35" fill="#0b1220"/>' +
    '<circle cx="46" cy="60" r="9" fill="#ffffff"/><circle cx="74" cy="60" r="9" fill="#ffffff"/>' +
    '<circle cx="48" cy="62" r="4.5" fill="#2563eb"/><circle cx="72" cy="62" r="4.5" fill="#2563eb"/>' +
    '<path d="M34 44Q46 35 57 42" fill="none" stroke="#93c5fd" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M65 45Q77 40 87 47" fill="none" stroke="#93c5fd" stroke-width="4" stroke-linecap="round"/>' +
    '<path d="M47 83Q60 92 73 83" fill="none" stroke="#ffffff" stroke-width="4" stroke-linecap="round"/>';

  /** Full standalone SVG document text. */
  function mascotSvg(size) {
    const w = size || 64;
    const h = Math.round((w * 130) / 120);
    return '<svg xmlns="' + SVG_NS + '" viewBox="0 0 120 130" width="' + w + '" height="' + h + '" role="img" aria-label="Prevy, the Prevenza assistant">' + INNER + "</svg>";
  }

  /** Build an <svg> element in the given document without using innerHTML. */
  function mascotElement(doc, size) {
    const parsed = new DOMParser().parseFromString(mascotSvg(size), "image/svg+xml");
    return doc.importNode(parsed.documentElement, true);
  }

  return { MASCOT_INNER: INNER, mascotSvg, mascotElement };
});

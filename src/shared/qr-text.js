/*
 * Prevenza: what to do with the text inside a QR code (Step 12). Pure functions: no storage, no network, no browser APIs.
 *
 * The page decodes a QR code in a picture the user chose (vendor/jsqr, on the device) and passes the text here. This
 * decides whether it is a UPI payment code, a web address or something else, and cleans it up for the checker it
 * belongs in. The text is never stored, and nothing is checked until the user presses a check button.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.qrText = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const MAX_UPI = 1000; // the UPI checker's QR box limit
  const MAX_LINK = 2048; // the link checker's limit
  const TEXT = Object.freeze({
    upi: {
      notice: "This picture also has a UPI payment QR code, read on this device. Do not trust it until you have checked who it pays.",
      button: "Check this QR payment",
    },
    link: {
      notice: "This picture also has a QR code with a web address in it, read on this device.",
      button: "Check this QR link",
    },
    other: { notice: "This picture also has a QR code, but it holds neither a UPI payment nor a web address.", button: "" },
    empty: { notice: "", button: "" },
  });

  /** Removes control characters and surrounding space. Returns "" for anything that is not text. */
  function clean(raw) {
    if (typeof raw !== "string") return "";
    return raw.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "").trim();
  }

  /**
   * classify(raw) -> { kind: "upi" | "link" | "other" | "empty", text, truncated, notice, button }
   * "upi" for upi:// codes (any case), "link" for a single http(s) address. "other" never carries its text.
   */
  function classify(raw) {
    const all = clean(raw);
    let kind = "empty";
    if (all) kind = /^upi:\/\//i.test(all) ? "upi" : /^https?:\/\/\S+$/i.test(all) ? "link" : "other";
    const max = kind === "upi" ? MAX_UPI : MAX_LINK;
    const keep = kind === "upi" || kind === "link";
    const truncated = keep && all.length > max;
    if (kind === "link" && truncated) kind = "other"; // a cut-off web address would be a different address
    return Object.assign({ kind, text: kind === "upi" || kind === "link" ? all.slice(0, max) : "", truncated: kind === "upi" && truncated }, TEXT[kind]);
  }

  return Object.freeze({ classify, MAX_UPI, MAX_LINK, TEXT });
});

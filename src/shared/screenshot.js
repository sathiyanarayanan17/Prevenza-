/*
 * Prevenza: screenshot helpers (Step 6). Pure functions: no storage, no network, no browser APIs.
 *
 *   validateImage    checks a chosen file before any work is done: size, and the real file type (not just the name)
 *   assessOcrQuality decides whether the text that was read is good enough to rely on
 *   receiptFacts     notes which parts of a payment receipt are visible (never their values)
 *
 * None of these remember anything. The image and the text it contains are never stored.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.screenshot = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const LIMITS = Object.freeze({
    maxBytes: 8 * 1024 * 1024, // larger screenshots are refused before they are read
    minBytes: 64, // anything smaller cannot be a real image
    maxTextChars: 5000, // the text box and the analysis both stop here
  });

  // Languages offered for reading. "eng" also covers Hinglish, which is Hindi written in English letters.
  const OCR_LANGUAGES = Object.freeze([
    Object.freeze({ id: "eng", label: "English (also Hinglish)", codes: Object.freeze(["eng"]), scan: "auto" }),
    Object.freeze({ id: "hin", label: "\u0939\u093F\u0928\u094D\u0926\u0940 Hindi + English", codes: Object.freeze(["hin", "eng"]), scan: "hi" }),
    Object.freeze({ id: "tam", label: "\u0BA4\u0BAE\u0BBF\u0BB4\u0BCD Tamil + English", codes: Object.freeze(["tam", "eng"]), scan: "ta" }),
    Object.freeze({ id: "all", label: "English, Hindi and Tamil (slower)", codes: Object.freeze(["eng", "hin", "tam"]), scan: "auto" }),
  ]);

  const QUALITY = Object.freeze({
    minLetters: 8, // fewer letters than this is "very little text"
    poorConfidence: 45, // the reader's own confidence (0-100) below this is poor
    fairConfidence: 65,
  });

  /** The kind of image, judged from its first bytes. A renamed file does not fool this. */
  function sniffImageType(bytes) {
    if (!bytes || bytes.length < 4) return null;
    if (bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47) return "png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "jpeg";
    return null;
  }

  function megabytes(n) {
    return (n / 1048576).toFixed(1);
  }

  /**
   * info: { size } as reported by the browser. head: the first bytes of the file (may be omitted for the size check).
   * Returns { ok:true, kind } or { ok:false, error, message }.
   */
  function validateImage(info, head) {
    if (info === null || typeof info !== "object" || typeof info.size !== "number" || !Number.isFinite(info.size)) {
      return { ok: false, error: "empty", message: "Choose a screenshot first." };
    }
    if (info.size <= 0) return { ok: false, error: "empty", message: "That file is empty. Choose another screenshot." };
    if (info.size > LIMITS.maxBytes) {
      return { ok: false, error: "too-large", message: "That image is " + megabytes(info.size) + " MB. Choose a screenshot under " + megabytes(LIMITS.maxBytes) + " MB." };
    }
    if (info.size < LIMITS.minBytes) return { ok: false, error: "unsupported", message: "That file is too small to be a screenshot. Prevenza reads PNG and JPEG screenshots." };
    if (head === undefined) return { ok: true, kind: null };
    const kind = sniffImageType(head);
    if (!kind) return { ok: false, error: "unsupported", message: "Prevenza reads PNG and JPEG screenshots only. This file is not one of those." };
    return { ok: true, kind };
  }

  function countLetters(text) {
    const m = String(text).match(/\p{L}/gu);
    return m ? m.length : 0;
  }

  /**
   * How far the text that was read can be trusted. confidence is the reader's own score (0-100) or null.
   * level: "none" (nothing readable), "poor", "fair" or "good". Poor and none are never treated as "safe".
   */
  function assessOcrQuality(input) {
    const text = input && typeof input.text === "string" ? input.text : "";
    const confidence = input && typeof input.confidence === "number" && Number.isFinite(input.confidence) ? Math.max(0, Math.min(100, input.confidence)) : null;
    const letters = countLetters(text);
    if (letters === 0) return { level: "none", letters, confidence, message: "No readable text was found in this image. That does not mean it is safe. Try a clearer or larger screenshot, or choose the language the text is written in." };
    if (letters < QUALITY.minLetters) return { level: "poor", letters, confidence, message: "Only a few characters could be read. Try a clearer or larger screenshot." };
    if (confidence !== null && confidence < QUALITY.poorConfidence) return { level: "poor", letters, confidence, message: "The text was hard to read, so some words may be wrong. Check the text below and correct it, or try a clearer screenshot." };
    if (confidence !== null && confidence < QUALITY.fairConfidence) return { level: "fair", letters, confidence, message: "Some of the text may have been misread. Check the text below." };
    return { level: "good", letters, confidence, message: "" };
  }

  // ---------------------------------------------------------------- what part of a payment receipt is visible
  const SUCCESS_RE = /\b(?:payment|transaction|transfer)\s+(?:successful|successfully|completed|done|success)\b|\b(?:paid|sent|transferred)\s+successfully\b|\bmoney\s+(?:sent|transferred)\b|\bpaid\s+to\b|\bsent\s+to\b|भुगतान\s*सफल|पेमेंट\s*सफल|பணம்\s*செலுத்தப்பட்டது|வெற்றிகரமாக/u;
  const AMOUNT_RE = /(?:₹|\brs\b\.?|\binr\b)\s*\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s*(?:rupees|rs\b)/iu;
  const RECIPIENT_RE = /\b(?:paid\s+to|sent\s+to|to|recipient|beneficiary|payee|receiver)\b[:\s]+\S{2,}|[a-z0-9._-]{2,}@[a-z][a-z0-9]{1,30}\b/iu;
  const REFERENCE_RE = /\b(?:upi\s*ref(?:erence)?(?:\s*(?:no|id|number))?|utr|transaction\s*id|txn\s*id|ref(?:erence)?\s*(?:no|id|number))\b[\s:#.\-]*[a-z0-9]{6,}|\b\d{12}\b/iu;

  /**
   * Which parts of a payment receipt can be seen in the text. Only yes/no answers are returned, never the values.
   * A receipt that looks complete proves nothing: screenshots can be edited.
   */
  function receiptFacts(input) {
    const text = typeof input === "string" ? input.normalize("NFKC").toLowerCase() : "";
    const details = {
      successMessage: SUCCESS_RE.test(text),
      amount: AMOUNT_RE.test(text),
      recipient: RECIPIENT_RE.test(text),
      reference: REFERENCE_RE.test(text),
    };
    const count = Object.values(details).filter(Boolean).length;
    return { looksLikeReceipt: details.successMessage && count >= 2, details };
  }

  const RECEIPT_WARNING = "Do not trust a payment screenshot alone. Verify the payment in your own bank or UPI application.";
  const RECEIPT_CAVEAT = "A screenshot cannot show that money reached a bank account, and Prevenza cannot check whether a receipt is genuine.";

  return { LIMITS, OCR_LANGUAGES, QUALITY, sniffImageType, validateImage, assessOcrQuality, receiptFacts, countLetters, RECEIPT_WARNING, RECEIPT_CAVEAT };
});

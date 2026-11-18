/*
 * Prevenza: central risk engine RULES (data only). Everything here is configurable and runs offline.
 *
 * "Points" are the shared currency. Every detector (URL, message, UPI, screenshot, community) reports indicators
 * with a weight in points. The engine adds up UNIQUE evidence and turns the total into a 0-100 warning level.
 * The score is a warning level, NOT a probability that something is fraud.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.riskRules = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  // Total evidence points -> score. Straight lines between these corners. Chosen so that the
  // URL checker's own thresholds (3 and 6 points) land exactly on MEDIUM (25) and HIGH (50).
  const SCORE_CURVE = Object.freeze([
    Object.freeze([0, 0]), Object.freeze([3, 25]), Object.freeze([6, 50]), Object.freeze([12, 75]), Object.freeze([20, 92]), Object.freeze([40, 100]),
  ]);

  const CATEGORIES = Object.freeze([
    Object.freeze({ id: "LOW", min: 0, max: 24, label: "Low" }),
    Object.freeze({ id: "MEDIUM", min: 25, max: 49, label: "Medium" }),
    Object.freeze({ id: "HIGH", min: 50, max: 74, label: "High" }),
    Object.freeze({ id: "CRITICAL", min: 75, max: 100, label: "Critical" }),
  ]);

  // States without a score.
  const NO_SCORE = Object.freeze({
    NOT_SCANNED: Object.freeze({ id: "NOT_SCANNED", label: "Not scanned yet" }),
    INCONCLUSIVE: Object.freeze({ id: "INCONCLUSIVE", label: "Inconclusive" }),
  });

  // When a detector gives no weight, its severity word is turned into points like this.
  const SEVERITY_POINTS = Object.freeze({ info: 0, low: 1, medium: 2.5, high: 5, critical: 9 });

  const LIMITS = Object.freeze({
    maxIndicatorWeight: 12, // one indicator can never be worth more than this
    maxPointsPerModule: 14, // one detector can never push the total beyond this on its own
    maxIndicatorsPerModule: 60, // ignore anything beyond this (hostile or buggy input)
    maxEvidenceListed: 12,
    maxReasons: 5,
    mitigationShare: 0.5, // good signs can remove at most half of the warning points
    singleIndicatorMaxScore: 49, // one non-critical indicator alone never reaches HIGH
    criticalFloor: 75, // a critical indicator always means at least this score
    maxIdLength: 64,
    maxTextLength: 400,
  });

  // Indicator weights at or above these points are described in these words.
  const STRENGTH_WORDS = Object.freeze([
    Object.freeze({ min: 5, word: "strong" }),
    Object.freeze({ min: 2, word: "moderate" }),
    Object.freeze({ min: 0.01, word: "minor" }),
  ]);

  // The detectors the engine knows about. "available:false" means the module does not exist yet.
  const MODULES = Object.freeze([
    Object.freeze({ id: "url", label: "Website address", available: true }),
    Object.freeze({ id: "message", label: "Message text", available: true }),
    Object.freeze({ id: "payment", label: "UPI payment details", available: true }),
    Object.freeze({ id: "screenshot", label: "Screenshot text", available: true }),
    Object.freeze({ id: "community", label: "Community reports", available: false, reason: "This check is not built yet." }),
  ]);

  const CATEGORY_ACTIONS = Object.freeze({
    LOW: "No strong warning signs were found in what was checked. That is not a guarantee. Stay careful with passwords, codes and payments.",
    MEDIUM: "Pause and check this independently before you act. Use an official website, app or phone number that you already know.",
    HIGH: "Do not enter payment details, passwords or codes until you have verified this independently with the real organisation or someone you trust.",
    CRITICAL: "Stop. Do not pay, do not share any code and do not click again. Verify with the real organisation using contact details you already know, and ask someone you trust.",
    INCONCLUSIVE: "Prevenza could not analyse this reliably. That does not mean it is safe. Verify it independently before you act.",
    NOT_SCANNED: "Nothing has been checked yet.",
  });

  // Extra advice that appears ONLY when matching evidence was actually found. Matched against indicator ids.
  const ACTION_HINTS = Object.freeze([
    Object.freeze({ when: /otp|pin|credential|password|cvv/, text: "Never share your OTP, UPI PIN or password with anyone, even if they say they are from your bank." }),
    Object.freeze({ when: /pay_to_receive|collect|receive_money|qr_receive/, text: "You never need to enter a PIN or pay money in order to receive money." }),
    Object.freeze({ when: /safe_account|custody/, text: "There is no such thing as a safe account for your money. Do not transfer money to one." }),
    Object.freeze({ when: /arrest|police|authority|impersonat/, text: "Police, courts and banks do not demand money or codes over a call or message." }),
    Object.freeze({ when: /shortener/, text: "Ask the sender for the full link, or open the official website yourself." }),
    Object.freeze({ when: /brand_|lookalike|homograph|typosquat|at_sign|misleading_subdomain/, text: "Type the official website address yourself, or use the official app." }),
    Object.freeze({ when: /kyc/, text: "Banks do not ask you to complete KYC through a link in a message. Visit your bank or use its official app." }),
    Object.freeze({ when: /parcel|customs|delivery_fee/, text: "Check any parcel in the courier's official app. Do not pay fees through a link in a message." }),
    Object.freeze({ when: /easy_earning|task_fee/, text: "A real employer never asks you to pay to get a job, and you never need to deposit money to receive your earnings." }),
    Object.freeze({ when: /prize|lottery|reward/, text: "You cannot win a prize you did not enter, and real prizes never need a fee." }),
    Object.freeze({ when: /remote_access/, text: "Do not install an app or share your screen because someone asks you to." }),
    Object.freeze({ when: /customer_care/, text: "Find your bank's number on its official website or on your card, not in the message." }),
    Object.freeze({ when: /fake_receipt|payment_screenshot|release_goods/, text: "Do not trust a payment screenshot alone. Check your own bank or UPI app before you release anything." }),
    Object.freeze({ when: /^upi_(id|name|handle|qr_recipient)/, text: "Check that the name your UPI app shows for the recipient is the person or company you meant to pay." }),
    Object.freeze({ when: /^upi_amount|^upi_qr_amount/, text: "Confirm the amount with the recipient, on a phone number you already know, before you pay." }),
  ]);

  return Object.freeze({ SCORE_CURVE, CATEGORIES, NO_SCORE, SEVERITY_POINTS, LIMITS, STRENGTH_WORDS, MODULES, CATEGORY_ACTIONS, ACTION_HINTS });
});

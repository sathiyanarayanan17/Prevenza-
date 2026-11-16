/*
 * Prevenza: UPI payment analyzer RULES (Step 5). Data only. Everything is configurable and runs on the device.
 *
 * Principles
 *   - An unfamiliar UPI ID is NOT a warning sign. Most people's IDs, and most small shops' IDs, are unfamiliar. Only
 *     specific, explainable things are flagged: a bank or support word inside the ID, a look-alike bank name after the @,
 *     a code that takes money instead of sending it, and so on.
 *   - Weights are points for the central risk engine (risk-rules.js). One weak sign is never enough on its own.
 *   - The word lists are short and hand-written. They are examples of known tricks, not a full list of banks.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.upiRules = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  // Common UPI handles (the part after @). Used to spot look-alikes of the long ones, never to flag unknown ones.
  const HANDLES = Object.freeze([
    "okhdfcbank", "okicici", "okaxis", "oksbi", "okbizaxis", "ybl", "ibl", "axl", "paytm", "apl", "upi", "sbi", "icici", "hdfcbank",
    "axisbank", "fbl", "barodampay", "postbank", "ikwik", "freecharge", "pingpay", "yesbank", "kotak", "pnb", "cnrb", "unionbank",
    "idfcfirst", "jupiter", "airtel", "jio", "ptyes", "ptsbi", "pthdfc", "ptaxis", "hdfcbankjd", "aubank", "indus", "federal",
  ]);

  // Names that fake accounts like to borrow. "handles" are the genuine handles of that brand: a brand name in an ID that ends
  // with its own handle is not flagged.
  const BRANDS = Object.freeze([
    { id: "sbi", label: "SBI", tokens: ["sbi", "statebank", "sbiyono"], handles: ["sbi", "oksbi", "ptsbi"] },
    { id: "hdfc", label: "HDFC", tokens: ["hdfc", "hdfcbank"], handles: ["hdfcbank", "okhdfcbank", "pthdfc", "hdfcbankjd"] },
    { id: "icici", label: "ICICI", tokens: ["icici", "icicibank"], handles: ["icici", "okicici"] },
    { id: "axis", label: "Axis", tokens: ["axis", "axisbank"], handles: ["axisbank", "okaxis", "ptaxis", "okbizaxis", "axl"] },
    { id: "pnb", label: "PNB", tokens: ["pnb"], handles: ["pnb"] },
    { id: "kotak", label: "Kotak", tokens: ["kotak"], handles: ["kotak"] },
    { id: "paytm", label: "Paytm", tokens: ["paytm", "paytmbank"], handles: ["paytm", "ptyes", "ptsbi", "pthdfc", "ptaxis"] },
    { id: "phonepe", label: "PhonePe", tokens: ["phonepe"], handles: ["ybl", "ibl", "axl"] },
    { id: "gpay", label: "Google Pay", tokens: ["gpay", "googlepay", "gpaybank"], handles: ["okhdfcbank", "okicici", "okaxis", "oksbi"] },
    { id: "bhim", label: "BHIM", tokens: ["bhim"], handles: ["upi"] },
    { id: "amazon", label: "Amazon", tokens: ["amazon", "amazonpay"], handles: ["apl", "yapl"] },
    { id: "npci", label: "NPCI", tokens: ["npci"], handles: [] },
    { id: "rbi", label: "RBI", tokens: ["rbi"], handles: [] },
    { id: "uidai", label: "UIDAI or Aadhaar", tokens: ["uidai", "aadhaar", "aadhar"], handles: [] },
  ]);

  // Words that make a personal-style ID or a name sound official. Matched as whole words (a trailing number is ignored).
  // Weak words such as "care" or "help" are not here on their own; "customer"+"care" is matched as "customercare".
  const SUPPORT_WORDS = Object.freeze([
    "customercare", "customersupport", "customerservice", "support", "helpdesk", "helpline", "refund", "refunds", "kyc", "verify",
    "verification", "cashback", "reward", "rewards", "lottery", "prize", "winner", "official", "govt", "government", "police", "cbi",
    "incometax", "taxrefund", "claim", "officer", "department", "dept", "bank", "banking", "service", "services",
  ]);

  // Shortest ones are tolerated in names that are ordinary words ("services", "bank") only when combined with a brand.
  const WEAK_SUPPORT = Object.freeze(["bank", "banking", "service", "services", "department", "dept", "officer", "claim", "official"]);

  // Amount limits (rupees).
  const AMOUNTS = Object.freeze({
    attention: 50000, // from here the amount is mentioned
    unusual: 100000, // many UPI payments are capped near this; larger is unusual for an ordinary payment
    impossible: 1000000000, // beyond this the number is not read as a payment amount
  });

  // Where a pasted payment code may come from. "upi://pay?pa=..." is the standard form.
  const QR_SCHEMES = Object.freeze(["upi", "tez", "gpay", "phonepe", "paytmmp", "bhim", "credpay", "upiapp"]);
  const QR_KINDS = Object.freeze(["pay", "collect", "mandate"]);

  const LIMITS = Object.freeze({
    upiId: 100,
    name: 100,
    amount: 40,
    reason: 1000,
    qrText: 1000,
    handleLookalikeMinLength: 6, // shorter handles are too close to each other to compare
  });

  // The warning signs the analyzer itself raises (the reason text is checked by the message scanner, see message-scan.js).
  // Ids avoid the words the risk engine uses to pick advice for other checks (brand_, lookalike ...), so advice stays on topic.
  const INDICATORS = Object.freeze({
    upi_id_bank_name: {
      weight: 2,
      label: "The UPI ID contains the name of a bank or payment app",
      why: "Banks and payment apps do not collect money through personal-style UPI IDs, and anyone can pick a name like this. It is only a hint, so check who it really belongs to.",
    },
    upi_id_support_word: {
      weight: 2.5,
      label: "The UPI ID contains a word like \"refund\", \"support\" or \"official\"",
      why: "Real support teams and refund departments do not ask you to pay a personal-style UPI ID. Scammers choose names like this to look trustworthy.",
    },
    upi_handle_lookalike: {
      weight: 3.5,
      label: "The part after the @ looks like a real bank name with a letter changed",
      why: "A small spelling change can turn a real bank name into a different one. Check the ID letter by letter.",
    },
    upi_name_official_claim: {
      weight: 2.5,
      label: "The recipient name sounds like a bank, a support desk or an official",
      why: "A name can be typed by anyone. The name your UPI app shows after you enter the ID comes from the bank, so trust that instead.",
    },
    upi_amount_large: {
      weight: 1,
      label: "The amount is large",
      why: "A large payment is worth checking twice, with the recipient, on a phone number you already know.",
    },
    upi_amount_unusual: {
      weight: 2,
      label: "The amount is above what many UPI payments allow",
      why: "Many UPI payments are limited to about 1 lakh rupees. A larger amount is unusual for an ordinary payment. Check it carefully with the recipient.",
    },
    upi_qr_collect_request: {
      weight: 5,
      label: "This code asks to take money from you, not to send it",
      why: "A \"collect\" request pulls money out of your account when you approve it. You never need to approve anything to receive money.",
    },
    upi_qr_autopay_mandate: {
      weight: 4,
      label: "This code sets up a repeating automatic payment",
      why: "A mandate lets someone take money from your account again and again. Do not approve one unless you asked for it.",
    },
    upi_qr_recipient_differs: {
      weight: 3,
      label: "The recipient in the code is different from the UPI ID you typed",
      why: "The code would send money to someone other than the person you typed. Find out why before you pay.",
    },
    upi_qr_amount_differs: {
      weight: 2.5,
      label: "The amount in the code is different from the amount you typed",
      why: "The code asks for a different amount than the one you expect. Check the amount on your UPI app before you pay.",
    },
  });

  return Object.freeze({ HANDLES, BRANDS, SUPPORT_WORDS, WEAK_SUPPORT, AMOUNTS, QR_SCHEMES, QR_KINDS, LIMITS, INDICATORS });
});

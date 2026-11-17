/*
 * Prevenza: Emergency Help content (Step 9). Data and small pure functions only: no DOM, no storage, no network.
 *
 * What this is: calm, general safety guidance for the moments after a possible scam, plus the official places to
 * report financial cyber fraud in India. It is information only.
 *
 * What it never does: call or message anyone, submit a complaint, collect contacts, bank details, OTPs or PINs,
 * or promise that money can be frozen, reversed or recovered. Prevenza cannot do those things.
 *
 * Official details, exactly as supplied for this project and used nowhere else:
 *   the National Cyber Crime Reporting Portal address and the cyber financial fraud helpline 1930.
 * No other phone number appears anywhere. Steps say "use the number on your card, passbook or official website".
 *
 * Language: the steps are English only. Hindi and Tamil are NOT offered for this safety wording, because it has not
 * been reviewed by a native speaker. The page says so when another language is selected. The few interface labels
 * (button, title, back link) and the Step 8 "Ask someone you trust" guide are translated elsewhere (i18n.js,
 * elder-text.js) and follow the same rule: they need native-speaker review.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.emergency = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const OFFICIAL = {
    portalName: "National Cyber Crime Reporting Portal",
    portalUrl: "https://cybercrime.gov.in/",
    helplineName: "Cyber financial fraud helpline",
    helplineNumber: "1930",
  };

  /** The guidance for "Ask someone you trust", word for word as specified. */
  const TRUST_SENTENCE =
    "Pause before taking action. Contact someone you trust using a phone number you already know. Do not use contact details supplied in a suspicious message.";

  const TEXT = {
    heading: "Emergency Help",
    calm: "Take a breath. You are not in trouble, and you are not alone. We will go one step at a time.",
    calmElder: "Take a breath. You are not in trouble. We will go slowly, one step at a time.",
    pickHeading: "What happened?",
    pickHelp: "Choose the one that is closest. Do not type any private details here. Nothing you choose is saved.",
    stepsHeading: "What to do now",
    invalid: "We could not find that choice. Please pick one from the list below.",
    noneChosen: "Choose what happened above, and the steps will appear here.",
    limits: "Prevenza cannot freeze accounts, reverse payments or recover money. Your bank and the official authorities decide what can be done.",
    languageNote: "The emergency steps are in English for now. The page title, the main buttons and the Ask someone you trust guide follow the language you chose in Settings.",
    stepOf: "Step {n} of {total}",
    next: "Next step",
    back: "Previous step",
    last: "That was the last step. You can choose another situation, or go back to the dashboard.",
    reportHeading: "Report financial cyber fraud (India)",
    reportIntro: "If you may have lost money or shared banking details in an online fraud, report it as quickly as possible. Contact your bank immediately as well. Both matter.",
    reportIntroElder: "If you lost money, or shared bank details, report it as soon as you can. Call your bank at once too.",
    portalButton: "Open the official reporting portal",
    portalHelp: "This opens the website in a new tab. Nothing is sent or filed until you do it yourself on that website.",
    copyButton: "Copy helpline number",
    copied: "Copied 1930. Nothing was called or sent. You can now paste it where you need it.",
    copyFailed: "Could not copy automatically. The helpline number is 1930. You can type it yourself.",
    helplineHelp: "Prevenza never makes the call for you. If you call, use your own phone.",
    bankReminder: "Also contact your bank immediately, using the official contact details on your card, passbook, or the bank's own website or app.",
    verifyNote: "Before you type anything, check that the website address in your browser is the one shown here.",
    outside: "Not in India? Use the official cybercrime or police channel of your own country.",
    trustHeading: "Ask someone you trust",
    back_dashboard: "Return to dashboard",
  };

  // Each incident: the normal steps, and shorter, simpler steps for Elder Mode (shown one at a time).
  const INCIDENTS = [
    {
      id: "money",
      label: "I sent money to a scammer",
      title: "I may have sent money to a scammer",
      steps: [
        "Stop sending any more money, even if you are told it will fix the problem.",
        "Contact your bank immediately. Use the official contact details on your card or passbook, or on your bank's own website or app. Do not use a number from a message or from the caller.",
        "Report the transaction through the official reporting channel shown below, as quickly as possible.",
        "Keep your evidence: transaction reference numbers, the date, time and amount, and any messages or call details. Do not delete them.",
        "Do not trust anyone who promises guaranteed recovery of your money for an upfront fee. That is often a second scam.",
      ],
      elderSteps: [
        "Stop. Do not send any more money.",
        "Call your bank now. Use the number on your bank card or passbook.",
        "Report it on the official website or helpline shown further down this page. Do it as soon as you can.",
        "Keep the payment details and the messages. Do not delete them.",
        "If someone says they can get your money back for a fee, do not pay them.",
      ],
    },
    {
      id: "otp_pin",
      label: "I shared my OTP or UPI PIN",
      title: "I shared my UPI PIN or OTP",
      steps: [
        "Contact your bank immediately. Use the official contact details on your card or passbook, or on your bank's own website or app.",
        "Follow the bank's instructions to secure your account.",
        "Change or reset your credentials, such as your UPI PIN or net banking password, through official banking channels, as your bank advises.",
        "Never share another OTP or PIN with anyone who says they are helping you, even if they say they are from the bank or the police.",
        "If money has left your account, report it through the official channel shown below.",
      ],
      elderSteps: [
        "Call your bank now. Use the number on your bank card or passbook.",
        "Do what the bank tells you, to protect your account.",
        "Change your PIN or password only in the way your bank tells you.",
        "Do not tell any other OTP or PIN to anyone. Not even to a person who says they want to help.",
        "If money is missing, report it on the official website or helpline shown further down this page.",
      ],
    },
    {
      id: "link",
      label: "I clicked a suspicious link",
      title: "I clicked a suspicious link",
      steps: [
        "Do not enter any more personal or banking information.",
        "Close the suspicious page.",
        "If you already entered a password, card details or other login details, contact the relevant bank or service immediately, using official contact details.",
        "Do not download unknown files or install unknown apps.",
      ],
      elderSteps: [
        "Do not type anything more on that page.",
        "Close the page.",
        "If you already typed a password or bank details, call your bank or that service now. Use a number you already know.",
        "Do not download files or install apps from that page.",
      ],
    },
    {
      id: "fake_kyc",
      label: "I got a fake bank or KYC message",
      title: "I received a fake bank or KYC message",
      steps: [
        "Do not tap links, open attachments or call numbers in the message.",
        "Do not share OTPs, PINs, passwords or card details. A real bank does not need them in a message.",
        "To check, contact your bank using its official contact details, or open the bank app you already have. Type the bank's website address yourself.",
        "If you already tapped the link, typed details or shared an OTP or PIN, contact your bank immediately.",
        "If money has been taken, report it through the official channel shown below.",
      ],
      elderSteps: [
        "Do not tap the link. Do not call the number in the message.",
        "Do not tell anyone your OTP, PIN or password.",
        "To check, call your bank on the number on your bank card, or open the bank app you already have.",
        "If you already tapped the link or shared details, call your bank now.",
        "If money is missing, report it on the official website or helpline shown further down this page.",
      ],
    },
    {
      id: "arrest",
      label: "Someone is threatening me with digital arrest",
      title: "Someone is threatening me with digital arrest",
      steps: [
        "Stay calm. Scammers use fear and hurry to stop you from thinking.",
        "Do not transfer money because of threats.",
        "Do not share OTPs, PINs or personal information.",
        "Verify the situation independently. End the call, then contact the agency using official contact details that you find yourself, not the ones the caller gave you.",
        "Seek help through official authorities and trusted people. If you lost money or shared details, use the reporting steps below.",
      ],
      elderSteps: [
        "Stay calm. You are safe to hang up.",
        "Do not send money because of threats.",
        "Do not tell anyone your OTP, PIN or personal details.",
        "Hang up. Then check on your own, using a number you already know or find on an official website.",
        "Tell someone you trust. If you lost money, report it on the official website or helpline shown further down this page.",
      ],
    },
    {
      id: "fake_receipt",
      label: "I received a fake payment screenshot",
      title: "I received a fake payment screenshot",
      steps: [
        "Do not hand over goods or services based only on a screenshot.",
        "Check your own bank or UPI application.",
        "Verify whether the money has actually arrived in your account.",
        "If the money has not arrived, do not release the goods. If you already did, keep the screenshot and chat, contact your bank, and use the reporting steps below.",
      ],
      elderSteps: [
        "Do not give the goods yet. A screenshot is not proof of payment.",
        "Open your own bank or UPI app.",
        "Check that the money has really arrived.",
        "If you already gave the goods, keep the screenshot and the chat. Call your bank, and use the reporting steps further down this page.",
      ],
    },
    {
      id: "other",
      label: "Something else looks suspicious",
      title: "Other suspicious activity",
      steps: [
        "Pause. Do not send money, share OTPs, PINs or passwords, click links or install apps.",
        "Verify independently, using contact details you already know or find on an official website. Do not use details given in the suspicious message or call.",
        "Ask someone you trust before you act.",
        "If you have already lost money or shared banking details, contact your bank immediately and use the reporting steps below.",
      ],
      elderSteps: [
        "Pause. Do not send money. Do not share OTPs, PINs or passwords.",
        "Do not tap links or install apps.",
        "Check on your own, using a number you already know. Do not use a number from the message.",
        "Ask someone you trust before you do anything.",
        "If you already lost money or shared bank details, call your bank now and use the reporting steps further down this page.",
      ],
    },
  ];

  function deepFreeze(o) {
    Object.values(o).forEach((v) => {
      if (v && typeof v === "object") deepFreeze(v);
    });
    return Object.freeze(o);
  }
  deepFreeze(OFFICIAL);
  deepFreeze(TEXT);
  deepFreeze(INCIDENTS);

  const BY_ID = new Map(INCIDENTS.map((i) => [i.id, i]));

  /** The incident for an id, or null for anything that is not one of the known ids (no prototype tricks, no non-strings). */
  function getIncident(id) {
    return typeof id === "string" && BY_ID.has(id) ? BY_ID.get(id) : null;
  }

  /** The steps to show: the short list for Elder Mode, the full list otherwise. Empty for an unknown incident. */
  function stepsFor(id, elder) {
    const incident = getIncident(id);
    if (!incident) return [];
    return elder ? incident.elderSteps : incident.steps;
  }

  /**
   * Read an incident from a page address fragment such as "#money".
   * Returns { state: "none" } when there is nothing to read, { state: "valid", id } for a known incident, and
   * { state: "invalid" } for anything else, so a hand-typed or damaged address never selects something by accident.
   */
  function parseHash(hash) {
    const raw = typeof hash === "string" ? hash.replace(/^#/, "") : "";
    if (!raw) return { state: "none" };
    return getIncident(raw) ? { state: "valid", id: raw } : { state: "invalid" };
  }

  /** "Step 2 of 5" */
  function stepLabel(n, total) {
    return TEXT.stepOf.replace("{n}", String(n)).replace("{total}", String(total));
  }

  return { OFFICIAL, TRUST_SENTENCE, TEXT, INCIDENTS, getIncident, stepsFor, parseHash, stepLabel };
});

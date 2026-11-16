/*
 * Prevenza: interface labels in English, Hindi and Tamil (Step 8).
 *
 * This is a SMALL set: page headings, the main buttons, the risk labels, and the Elder Mode and language settings.
 * Everything else (explanations under each heading, the reasons each checker gives, statistics, system check,
 * messages such as "Could not save") stays in English. Prevy's warnings and the family guide are translated
 * separately (holdy-text.js, elder-text.js). Do not describe the interface as "fully translated".
 *
 * Elements opt in with data-i18n="key". English is left exactly as written in the HTML. apply() swaps the text for
 * Hindi or Tamil and restores English afterwards. It only ever sets text (never HTML) and stores nothing.
 *
 * NEEDS NATIVE-SPEAKER REVIEW: the Hindi and Tamil text was written by the developer, not by a native speaker.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.i18n = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  const en = {
    nav_dashboard: "Dashboard",
    nav_settings: "Settings",
    pill_low: "Low risk",
    pill_medium: "Medium risk",
    pill_high: "High risk",
    pill_critical: "Critical risk",
    pill_inconclusive: "Inconclusive",
    pill_none: "Not scanned yet",
    // popup
    popup_protection: "Protection",
    popup_page: "This page",
    popup_dashboard: "Dashboard",
    popup_message: "Check a message",
    popup_settings: "Settings",
    popup_hello: "Say hi to Prevy",
    popup_footer: "Everything stays on your device. Nothing is sent anywhere.",
    // dashboard
    dash_hero: "Pause. Let's check first.",
    dash_link: "Check a link",
    dash_message: "Check a message",
    dash_upi: "Check a UPI payment",
    dash_shot: "Check a screenshot",
    dash_more: "More tools and information",
    trust_title: "Ask someone you trust",
    trust_sub: "Not sure about something? Read this before you send money or share any details.",
    btn_check_link: "Check link",
    btn_analyze_message: "Analyze message",
    btn_analyze_payment: "Analyze payment",
    btn_read_shot: "Read and check screenshot",
    btn_choose_shot: "Choose a screenshot",
    btn_clear: "Clear",
    // settings
    set_general: "General",
    set_assistant: "Assistant and accessibility",
    set_elder: "Elder mode",
    set_elder_help: "Bigger text and buttons, stronger contrast, simple words and a simpler dashboard.",
    set_language: "Language",
    set_language_help: "Prevy's warnings, the Ask someone you trust guide and the main headings and buttons change. Other details stay in English.",
  };

  const hi = {
    nav_dashboard: "डैशबोर्ड",
    nav_settings: "सेटिंग्स",
    pill_low: "कम जोखिम",
    pill_medium: "मध्यम जोखिम",
    pill_high: "ज़्यादा जोखिम",
    pill_critical: "गंभीर जोखिम",
    pill_inconclusive: "तय नहीं हो सका",
    pill_none: "अभी जाँच नहीं हुई",
    popup_protection: "सुरक्षा",
    popup_page: "यह पेज",
    popup_dashboard: "डैशबोर्ड",
    popup_message: "संदेश जाँचें",
    popup_settings: "सेटिंग्स",
    popup_hello: "Prevy को नमस्ते कहें",
    popup_footer: "सब कुछ आपके डिवाइस पर रहता है। कुछ भी कहीं नहीं भेजा जाता।",
    dash_hero: "रुकिए। पहले जाँच लेते हैं।",
    dash_link: "लिंक जाँचें",
    dash_message: "संदेश जाँचें",
    dash_upi: "UPI भुगतान जाँचें",
    dash_shot: "स्क्रीनशॉट जाँचें",
    dash_more: "और औज़ार और जानकारी",
    trust_title: "किसी भरोसेमंद व्यक्ति से पूछें",
    trust_sub: "किसी बात पर भरोसा नहीं है? पैसे भेजने या जानकारी देने से पहले यह पढ़ें।",
    btn_check_link: "लिंक जाँचें",
    btn_analyze_message: "संदेश जाँचें",
    btn_analyze_payment: "भुगतान जाँचें",
    btn_read_shot: "स्क्रीनशॉट पढ़ें और जाँचें",
    btn_choose_shot: "स्क्रीनशॉट चुनें",
    btn_clear: "साफ़ करें",
    set_general: "सामान्य",
    set_assistant: "सहायक और सुगमता",
    set_elder: "बड़ों के लिए आसान मोड",
    set_elder_help: "बड़े अक्षर और बटन, ज़्यादा साफ़ रंग, आसान शब्द और सरल डैशबोर्ड।",
    set_language: "भाषा",
    set_language_help: "Prevy की चेतावनियाँ, \"किसी भरोसेमंद व्यक्ति से पूछें\" गाइड और मुख्य शीर्षक व बटन बदल जाएँगे। बाकी विवरण अंग्रेज़ी में रहेंगे।",
  };

  const ta = {
    nav_dashboard: "டாஷ்போர்டு",
    nav_settings: "அமைப்புகள்",
    pill_low: "குறைந்த ஆபத்து",
    pill_medium: "நடுத்தர ஆபத்து",
    pill_high: "அதிக ஆபத்து",
    pill_critical: "மிக அதிக ஆபத்து",
    pill_inconclusive: "உறுதியாகத் தெரியவில்லை",
    pill_none: "இன்னும் சரிபார்க்கப்படவில்லை",
    popup_protection: "பாதுகாப்பு",
    popup_page: "இந்தப் பக்கம்",
    popup_dashboard: "டாஷ்போர்டு",
    popup_message: "செய்தியைச் சரிபார்க்கவும்",
    popup_settings: "அமைப்புகள்",
    popup_hello: "Prevy-க்கு வணக்கம் சொல்லுங்கள்",
    popup_footer: "எல்லாம் உங்கள் சாதனத்திலேயே இருக்கும். எதுவும் எங்கும் அனுப்பப்படாது.",
    dash_hero: "நில்லுங்கள். முதலில் சரிபார்ப்போம்.",
    dash_link: "இணைப்பைச் சரிபார்க்கவும்",
    dash_message: "செய்தியைச் சரிபார்க்கவும்",
    dash_upi: "UPI பணம் செலுத்துதலைச் சரிபார்க்கவும்",
    dash_shot: "ஸ்கிரீன்ஷாட்டைச் சரிபார்க்கவும்",
    dash_more: "மேலும் கருவிகளும் தகவல்களும்",
    trust_title: "நம்பிக்கையான ஒருவரிடம் கேளுங்கள்",
    trust_sub: "ஒரு விஷயத்தில் உறுதி இல்லையா? பணம் அனுப்பும் முன் அல்லது விவரங்களைப் பகிரும் முன் இதைப் படியுங்கள்.",
    btn_check_link: "இணைப்பைச் சரிபார்",
    btn_analyze_message: "செய்தியைச் சரிபார்",
    btn_analyze_payment: "பணம் செலுத்துதலைச் சரிபார்",
    btn_read_shot: "ஸ்கிரீன்ஷாட்டைப் படித்துச் சரிபார்",
    btn_choose_shot: "ஸ்கிரீன்ஷாட்டைத் தேர்ந்தெடுங்கள்",
    btn_clear: "அழி",
    set_general: "பொது",
    set_assistant: "உதவியாளர் மற்றும் எளிதாகப் பயன்படுத்துதல்",
    set_elder: "மூத்தோர் எளிய முறை",
    set_elder_help: "பெரிய எழுத்தும் பொத்தான்களும், தெளிவான நிறங்கள், எளிய சொற்கள், எளிய டாஷ்போர்டு.",
    set_language: "மொழி",
    set_language_help: "Prevy-யின் எச்சரிக்கைகள், \"நம்பிக்கையான ஒருவரிடம் கேளுங்கள்\" வழிகாட்டி, முக்கிய தலைப்புகள் மற்றும் பொத்தான்கள் மாறும். மற்ற விவரங்கள் ஆங்கிலத்திலேயே இருக்கும்.",
  };

  const TABLE = Object.freeze({ en: Object.freeze(en), hi: Object.freeze(hi), ta: Object.freeze(ta) });
  const CODES = Object.freeze(["en", "hi", "ta"]);

  /** The text for a key in a language. Unknown languages and missing keys fall back to English. */
  function t(language, key) {
    const set = TABLE[language] || TABLE.en;
    return typeof set[key] === "string" ? set[key] : typeof en[key] === "string" ? en[key] : "";
  }

  /**
   * Swap the text of every [data-i18n] element under root. English is whatever the HTML says: the first time an
   * element is seen its original text is remembered, so switching back to English restores it exactly.
   */
  function apply(root, language) {
    if (!root || typeof root.querySelectorAll !== "function") return 0;
    let changed = 0;
    root.querySelectorAll("[data-i18n]").forEach((el) => {
      if (!el.hasAttribute("data-i18n-en")) el.setAttribute("data-i18n-en", el.textContent);
      const key = el.getAttribute("data-i18n");
      const next = language !== "en" && TABLE[language] && typeof TABLE[language][key] === "string" ? TABLE[language][key] : el.getAttribute("data-i18n-en");
      if (el.textContent !== next) {
        el.textContent = next;
        changed++;
      }
    });
    return changed;
  }

  return { t, apply, TABLE, CODES };
});

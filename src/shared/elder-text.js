/*
 * Prevenza: Elder Mode wording (Step 8). Data only: no logic, no DOM, no storage, no network.
 *
 * Three parts, each in English, Hindi and Tamil:
 *   topics   a plain explanation per kind of scam: what was found, why it can be dangerous, and one or two next steps
 *   labels   headings and button text for the Elder Mode warning card
 *   family   the "Ask someone you trust" guide (information only)
 *
 * Rules for every sentence here: short, no technical words, calm, and never "safe". It never says Prevy will block,
 * cancel or reverse anything, and it never asks the user to type a phone number.
 *
 * NEEDS NATIVE-SPEAKER REVIEW: the Hindi and Tamil text was written by the developer, not by a native speaker or a
 * professional translator. Only the Elder Mode card, the family guide and a few interface labels (see i18n.js) are
 * translated. The detailed reasons from each checker stay in English.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.elderText = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const en = {
    topics: {
      secret: {
        found: "Someone may be trying to steal your password or OTP. Never share these details.",
        why: "With your OTP or PIN, a scammer can take money from your bank account.",
        steps: ["Do not tell anyone your OTP, PIN or password. This includes people who say they work for a bank.", "Close the message or end the call. Then call your bank on the number printed on your card."],
      },
      receive: {
        found: "Someone is asking you to pay money before you get money.",
        why: "A real refund, prize or payment never needs you to pay first. Scammers use this trick to take your money.",
        steps: ["Do not pay anything now.", "Check with the real company or bank, using a number you already know."],
      },
      safe_account: {
        found: "Someone is asking you to move your money to a \"safe account\".",
        why: "There is no safe account for your money. Scammers use this story to take people's money.",
        steps: ["Do not move any money.", "Call your bank on the number printed on your card or passbook."],
      },
      arrest: {
        found: "Someone says that the police or officers will arrest you.",
        why: "Police and courts do not arrest people over a phone call or ask them for money. This is a known scam.",
        steps: ["Do not pay, and do not stay on the call.", "Tell a family member you trust. Call your local police on a number you already know."],
      },
      release_goods: {
        found: "A payment screenshot is being used to ask you to hand over goods.",
        why: "Payment screenshots can be faked. You could lose both your goods and your money.",
        steps: ["Do not give anything yet.", "Open your own bank or UPI app and check that the money has really arrived."],
      },
      fee: {
        found: "You are being asked to pay a fee, or to update your details, through a message or a link.",
        why: "Banks and courier companies do not ask for fees or KYC updates through links. Scammers do.",
        steps: ["Do not tap the link and do not pay the fee.", "Visit the official website, or call the number printed on your card or bill."],
      },
      site_fake: {
        found: "This website may be pretending to be your bank or a well-known company.",
        why: "Scammers copy real websites to steal your login details and your money.",
        steps: ["Do not enter your bank details until you check the official website.", "Type the official website address yourself, or use the bank app you already have."],
      },
      site_odd: {
        found: "This web address looks strange, or it hides where it really goes.",
        why: "Scammers hide their websites behind strange links, hoping people will not look closely.",
        steps: ["Do not enter personal or bank details on this page.", "Check the official website yourself before you go on."],
      },
      screenshot_pay: {
        found: "This screenshot asks for a payment, or tells you to follow payment steps.",
        why: "Scammers send fake payment screenshots and payment steps to trick people.",
        steps: ["Do not pay or hand over anything yet.", "Check in your own bank or UPI app, or ask the person on a number you already know."],
      },
      upi: {
        found: "Check who will receive your money before paying.",
        why: "Money sent to the wrong person is very hard to get back. Some payment requests take money from you instead of giving it.",
        steps: ["Stop. Check the name and UPI ID of the person who will receive the money.", "If you are not sure, ask someone you trust before you pay."],
      },
      helpline: {
        found: "Someone may be pretending to be customer support.",
        why: "Fake helplines try to take control of your phone or computer, and then your bank account.",
        steps: ["Do not install any app and do not share your screen.", "Call the number printed on your card, your bill or the official website."],
      },
      money_request: {
        found: "Someone is asking you to send money.",
        why: "Scammers pretend to be family, friends or officials and ask for money very quickly.",
        steps: ["Do not send money yet.", "Call the person on a number you already know, and check that it is really them."],
      },
      message: {
        found: "This message has signs of a scam.",
        why: "Scam messages try to rush you, so you share money or details without thinking.",
        steps: ["Do not reply, tap links or call numbers in the message.", "Check with the real sender, using a number you already know."],
      },
      screenshot: {
        found: "This screenshot has signs of a scam.",
        why: "Pictures and chats can be faked. Someone may be trying to trick you.",
        steps: ["Do not act on it yet.", "Check with the real person or company, using a number you already know."],
      },
    },
    labels: {
      found: "What we found",
      why: "Why this can be dangerous",
      todo: "What to do now",
      trust: "Ask someone you trust",
      more: "More safety details",
      noteLow: "Before you pay or share any details, check for yourself with the real bank or company.",
      noteUnsure: "Please check with the real bank or company, or ask someone you trust, before you act.",
    },
    family: {
      title: "Ask someone you trust",
      intro: "A second pair of eyes can stop a scam. Here is how to do it safely.",
      points: [
        "Before sending money, call someone you trust using a number you already know.",
        "Do not use phone numbers provided in suspicious messages.",
        "Verify bank-related requests using your bank's official contact details.",
        "Tell them what you were asked to do. Do not share your OTP, PIN or password, even with family.",
        "Take your time. A real bank or company will wait while you check.",
      ],
      footer: "Prevenza does not contact anyone for you. It does not save phone numbers or send messages.",
      show: "Ask someone you trust",
      hide: "Close this guide",
    },
  };

  const hi = {
    topics: {
      secret: {
        found: "कोई आपका पासवर्ड या OTP चुराने की कोशिश कर सकता है। ये जानकारी कभी किसी को न बताएँ।",
        why: "OTP या PIN मिलने पर ठग आपके बैंक खाते से पैसे निकाल सकते हैं।",
        steps: ["अपना OTP, PIN या पासवर्ड किसी को न बताएँ। बैंक का कर्मचारी बताने वाले को भी नहीं।", "संदेश बंद कर दें या कॉल काट दें। फिर अपने कार्ड पर छपे नंबर से बैंक को फोन करें।"],
      },
      receive: {
        found: "कोई आपसे पैसे मिलने से पहले पैसे भेजने को कह रहा है।",
        why: "असली रिफंड, इनाम या भुगतान के लिए पहले पैसे नहीं देने पड़ते। ठग इसी तरह पैसे ऐंठते हैं।",
        steps: ["अभी कोई पैसा न भेजें।", "असली कंपनी या बैंक से, अपने जाने-पहचाने नंबर पर बात करके जाँच लें।"],
      },
      safe_account: {
        found: "कोई आपसे अपने पैसे \"सुरक्षित खाते\" में भेजने को कह रहा है।",
        why: "पैसों के लिए कोई सुरक्षित खाता नहीं होता। ठग इसी बहाने से लोगों के पैसे ले लेते हैं।",
        steps: ["कोई पैसा न भेजें।", "अपने कार्ड या पासबुक पर छपे नंबर पर बैंक को फोन करें।"],
      },
      arrest: {
        found: "कोई कह रहा है कि पुलिस या अधिकारी आपको गिरफ्तार करेंगे।",
        why: "पुलिस और अदालत फोन पर गिरफ्तारी नहीं करतीं और न पैसे माँगती हैं। यह एक जानी-पहचानी ठगी है।",
        steps: ["पैसे न दें और कॉल पर न रुकें।", "किसी भरोसेमंद परिवारजन को बताएँ। स्थानीय पुलिस को अपने जाने-पहचाने नंबर पर फोन करें।"],
      },
      release_goods: {
        found: "भुगतान के स्क्रीनशॉट के आधार पर आपसे सामान देने को कहा जा रहा है।",
        why: "भुगतान के स्क्रीनशॉट नकली हो सकते हैं। आपका सामान और पैसे, दोनों जा सकते हैं।",
        steps: ["अभी कुछ न दें।", "अपना बैंक या UPI ऐप खोलकर देखें कि पैसे सच में आए हैं या नहीं।"],
      },
      fee: {
        found: "संदेश या लिंक के ज़रिए आपसे शुल्क माँगा जा रहा है, या जानकारी अपडेट करने को कहा जा रहा है।",
        why: "बैंक और कूरियर कंपनियाँ लिंक के ज़रिए शुल्क या KYC अपडेट नहीं माँगतीं। ठग माँगते हैं।",
        steps: ["लिंक न खोलें और शुल्क न दें।", "आधिकारिक वेबसाइट देखें, या अपने कार्ड या बिल पर छपे नंबर पर फोन करें।"],
      },
      site_fake: {
        found: "यह वेबसाइट आपके बैंक या किसी जानी-मानी कंपनी की नकल हो सकती है।",
        why: "ठग असली वेबसाइट की नकल बनाकर आपका लॉगिन और पैसे चुराते हैं।",
        steps: ["आधिकारिक वेबसाइट जाँचे बिना अपनी बैंक जानकारी न भरें।", "वेबसाइट का पता खुद टाइप करें, या अपना बैंक ऐप इस्तेमाल करें।"],
      },
      site_odd: {
        found: "यह वेबसाइट पता अजीब लगता है, या छिपाता है कि वह असल में कहाँ जाता है।",
        why: "ठग अजीब लिंक के पीछे अपनी वेबसाइट छिपाते हैं, ताकि लोग ध्यान से न देखें।",
        steps: ["इस पेज पर निजी या बैंक जानकारी न भरें।", "आगे बढ़ने से पहले आधिकारिक वेबसाइट खुद जाँच लें।"],
      },
      screenshot_pay: {
        found: "यह स्क्रीनशॉट आपसे भुगतान करने, या भुगतान के निर्देश मानने को कहता है।",
        why: "ठग नकली भुगतान स्क्रीनशॉट और निर्देश भेजकर लोगों को फँसाते हैं।",
        steps: ["अभी भुगतान न करें और कुछ न दें।", "अपने बैंक या UPI ऐप में जाँचें, या उस व्यक्ति से जाने-पहचाने नंबर पर पूछें।"],
      },
      upi: {
        found: "भुगतान करने से पहले देखें कि आपके पैसे किसे मिलेंगे।",
        why: "गलत व्यक्ति को गया पैसा वापस पाना बहुत मुश्किल होता है। कुछ भुगतान अनुरोध पैसे देने की जगह आपके पैसे निकाल लेते हैं।",
        steps: ["रुकिए। पैसे पाने वाले का नाम और UPI ID जाँचिए।", "भरोसा न हो तो भुगतान से पहले किसी भरोसेमंद व्यक्ति से पूछिए।"],
      },
      helpline: {
        found: "कोई ग्राहक सहायता का रूप धरकर बात कर सकता है।",
        why: "नकली हेल्पलाइन आपके फोन या कंप्यूटर पर कब्ज़ा करने की कोशिश करती हैं, और फिर आपके बैंक खाते पर।",
        steps: ["कोई ऐप इंस्टॉल न करें और अपनी स्क्रीन साझा न करें।", "अपने कार्ड, बिल या आधिकारिक वेबसाइट पर छपे नंबर पर फोन करें।"],
      },
      money_request: {
        found: "कोई आपसे पैसे भेजने को कह रहा है।",
        why: "ठग परिवार, दोस्त या अधिकारी बनकर जल्दी में पैसे माँगते हैं।",
        steps: ["अभी पैसे न भेजें।", "उस व्यक्ति को अपने जाने-पहचाने नंबर पर फोन करके पक्का कर लें कि वही हैं।"],
      },
      message: {
        found: "इस संदेश में ठगी के संकेत हैं।",
        why: "ठगी वाले संदेश जल्दबाज़ी कराते हैं, ताकि आप बिना सोचे पैसे या जानकारी दे दें।",
        steps: ["जवाब न दें, लिंक न खोलें, और संदेश में दिए नंबर पर फोन न करें।", "असली भेजने वाले से अपने जाने-पहचाने नंबर पर पूछ लें।"],
      },
      screenshot: {
        found: "इस स्क्रीनशॉट में ठगी के संकेत हैं।",
        why: "तस्वीरें और चैट नकली हो सकती हैं। कोई आपको धोखा देने की कोशिश कर सकता है।",
        steps: ["अभी इस पर कुछ न करें।", "असली व्यक्ति या कंपनी से अपने जाने-पहचाने नंबर पर पूछ लें।"],
      },
    },
    labels: {
      found: "हमें क्या मिला",
      why: "यह खतरनाक क्यों हो सकता है",
      todo: "अभी क्या करें",
      trust: "किसी भरोसेमंद व्यक्ति से पूछें",
      more: "और सुरक्षा जानकारी",
      noteLow: "पैसे भेजने या कोई जानकारी देने से पहले, असली बैंक या कंपनी से खुद जाँच लें।",
      noteUnsure: "कुछ भी करने से पहले असली बैंक या कंपनी से पूछें, या किसी भरोसेमंद व्यक्ति से पूछ लें।",
    },
    family: {
      title: "किसी भरोसेमंद व्यक्ति से पूछें",
      intro: "दूसरे व्यक्ति की नज़र से कई बार ठगी रुक जाती है। इसे सुरक्षित तरीके से ऐसे करें।",
      points: [
        "पैसे भेजने से पहले, अपने जाने-पहचाने नंबर से किसी भरोसेमंद व्यक्ति को फोन करें।",
        "संदिग्ध संदेश में दिए गए फोन नंबरों का इस्तेमाल न करें।",
        "बैंक से जुड़े किसी भी अनुरोध की जाँच बैंक के आधिकारिक संपर्क विवरण से करें।",
        "उन्हें बताएँ कि आपसे क्या करने को कहा गया है। अपना OTP, PIN या पासवर्ड परिवार को भी न बताएँ।",
        "जल्दबाज़ी न करें। असली बैंक या कंपनी आपकी जाँच के लिए इंतज़ार करेगी।",
      ],
      footer: "Prevenza आपके लिए किसी से संपर्क नहीं करता। यह फोन नंबर सहेजता नहीं और कोई संदेश नहीं भेजता।",
      show: "किसी भरोसेमंद व्यक्ति से पूछें",
      hide: "यह गाइड बंद करें",
    },
  };

  const ta = {
    topics: {
      secret: {
        found: "யாரோ உங்கள் கடவுச்சொல்லை அல்லது OTP-ஐ திருட முயற்சிக்கலாம். இந்த விவரங்களை யாரிடமும் பகிராதீர்கள்.",
        why: "OTP அல்லது PIN கிடைத்தால், மோசடிக்காரர்கள் உங்கள் வங்கிக் கணக்கிலிருந்து பணத்தை எடுக்க முடியும்.",
        steps: ["உங்கள் OTP, PIN அல்லது கடவுச்சொல்லை யாரிடமும் சொல்லாதீர்கள். வங்கி ஊழியர் என்று சொல்பவரிடமும் வேண்டாம்.", "செய்தியை மூடுங்கள் அல்லது அழைப்பைத் துண்டியுங்கள். பிறகு உங்கள் கார்டில் உள்ள எண்ணில் வங்கியை அழையுங்கள்."],
      },
      receive: {
        found: "பணம் பெறுவதற்கு முன் நீங்கள் பணம் செலுத்த வேண்டும் என்று யாரோ கேட்கிறார்கள்.",
        why: "உண்மையான பணத்திருப்பம், பரிசு அல்லது பணம் பெற நீங்கள் முதலில் பணம் செலுத்த வேண்டியதில்லை. மோசடிக்காரர்கள் இப்படித்தான் பணம் பறிக்கிறார்கள்.",
        steps: ["இப்போது எதுவும் செலுத்தாதீர்கள்.", "உங்களுக்குத் தெரிந்த எண்ணில் உண்மையான நிறுவனம் அல்லது வங்கியிடம் உறுதிசெய்யுங்கள்."],
      },
      safe_account: {
        found: "உங்கள் பணத்தை \"பாதுகாப்பான கணக்கிற்கு\" மாற்றச் சொல்கிறார்கள்.",
        why: "பணத்திற்கு பாதுகாப்பான கணக்கு என்று ஒன்று இல்லை. மோசடிக்காரர்கள் இந்தக் கதையைச் சொல்லி மக்களின் பணத்தை எடுக்கிறார்கள்.",
        steps: ["எந்தப் பணத்தையும் மாற்றாதீர்கள்.", "உங்கள் கார்டு அல்லது பாஸ்புக்கில் அச்சிடப்பட்ட எண்ணில் வங்கியை அழையுங்கள்."],
      },
      arrest: {
        found: "போலீஸ் அல்லது அதிகாரிகள் உங்களைக் கைது செய்வார்கள் என்று யாரோ சொல்கிறார்கள்.",
        why: "போலீஸும் நீதிமன்றமும் தொலைபேசி அழைப்பில் யாரையும் கைது செய்வதில்லை, பணமும் கேட்பதில்லை. இது அறியப்பட்ட மோசடி.",
        steps: ["பணம் செலுத்தாதீர்கள், அழைப்பில் தொடராதீர்கள்.", "நம்பிக்கையான குடும்ப உறுப்பினரிடம் சொல்லுங்கள். உங்களுக்குத் தெரிந்த எண்ணில் உள்ளூர் காவல் நிலையத்தை அழையுங்கள்."],
      },
      release_goods: {
        found: "பணம் செலுத்திய ஸ்கிரீன்ஷாட்டை வைத்து பொருளைக் கொடுக்கச் சொல்கிறார்கள்.",
        why: "பணம் செலுத்திய ஸ்கிரீன்ஷாட்டுகளை போலியாக உருவாக்கலாம். உங்கள் பொருளையும் பணத்தையும் இழக்க நேரிடலாம்.",
        steps: ["இப்போது எதையும் கொடுக்காதீர்கள்.", "உங்கள் வங்கி அல்லது UPI செயலியைத் திறந்து பணம் உண்மையில் வந்துள்ளதா என்று பாருங்கள்."],
      },
      fee: {
        found: "செய்தி அல்லது இணைப்பு மூலம் கட்டணம் செலுத்தச் சொல்கிறார்கள், அல்லது விவரங்களைப் புதுப்பிக்கச் சொல்கிறார்கள்.",
        why: "வங்கிகளும் கூரியர் நிறுவனங்களும் இணைப்பு மூலம் கட்டணம் அல்லது KYC புதுப்பிப்பு கேட்பதில்லை. மோசடிக்காரர்கள்தான் கேட்கிறார்கள்.",
        steps: ["இணைப்பைத் தொடாதீர்கள், கட்டணம் செலுத்தாதீர்கள்.", "அதிகாரப்பூர்வ இணையதளத்தைப் பாருங்கள், அல்லது உங்கள் கார்டு அல்லது பில்லில் உள்ள எண்ணை அழையுங்கள்."],
      },
      site_fake: {
        found: "இந்த இணையதளம் உங்கள் வங்கி அல்லது பிரபல நிறுவனம் போல நடிக்கலாம்.",
        why: "மோசடிக்காரர்கள் உண்மையான இணையதளங்களைப் போலியாக உருவாக்கி உங்கள் உள்நுழைவு விவரங்களையும் பணத்தையும் திருடுகிறார்கள்.",
        steps: ["அதிகாரப்பூர்வ இணையதளத்தைச் சரிபார்க்கும் வரை உங்கள் வங்கி விவரங்களை உள்ளிடாதீர்கள்.", "இணையதள முகவரியை நீங்களே தட்டச்சு செய்யுங்கள், அல்லது உங்களிடம் உள்ள வங்கிச் செயலியைப் பயன்படுத்துங்கள்."],
      },
      site_odd: {
        found: "இந்த இணைய முகவரி வித்தியாசமாக உள்ளது, அல்லது அது உண்மையில் எங்கே செல்கிறது என்பதை மறைக்கிறது.",
        why: "மக்கள் கவனமாகப் பார்க்க மாட்டார்கள் என்று நினைத்து, மோசடிக்காரர்கள் விசித்திரமான இணைப்புகளுக்குப் பின்னால் தங்கள் இணையதளத்தை மறைக்கிறார்கள்.",
        steps: ["இந்தப் பக்கத்தில் தனிப்பட்ட அல்லது வங்கி விவரங்களை உள்ளிடாதீர்கள்.", "தொடர்வதற்கு முன் அதிகாரப்பூர்வ இணையதளத்தை நீங்களே சரிபாருங்கள்."],
      },
      screenshot_pay: {
        found: "இந்த ஸ்கிரீன்ஷாட் பணம் செலுத்தச் சொல்கிறது, அல்லது பணம் செலுத்தும் வழிமுறைகளைப் பின்பற்றச் சொல்கிறது.",
        why: "மோசடிக்காரர்கள் போலி பணம் செலுத்திய ஸ்கிரீன்ஷாட்டுகளையும் வழிமுறைகளையும் அனுப்பி ஏமாற்றுகிறார்கள்.",
        steps: ["இப்போது பணம் செலுத்தாதீர்கள், எதையும் கொடுக்காதீர்கள்.", "உங்கள் வங்கி அல்லது UPI செயலியில் சரிபாருங்கள், அல்லது தெரிந்த எண்ணில் அந்த நபரிடம் கேளுங்கள்."],
      },
      upi: {
        found: "பணம் செலுத்தும் முன், பணம் யாருக்குப் போகும் என்பதைச் சரிபாருங்கள்.",
        why: "தவறான நபருக்குச் சென்ற பணத்தைத் திரும்பப் பெறுவது மிகவும் கடினம். சில பணக் கோரிக்கைகள் பணம் தருவதற்குப் பதில் உங்கள் பணத்தை எடுத்துவிடும்.",
        steps: ["நில்லுங்கள். பணம் பெறுபவரின் பெயரையும் UPI ஐடியையும் சரிபாருங்கள்.", "உறுதியாக இல்லையென்றால், பணம் செலுத்தும் முன் நம்பிக்கையான ஒருவரிடம் கேளுங்கள்."],
      },
      helpline: {
        found: "யாரோ வாடிக்கையாளர் சேவை போல நடிக்கலாம்.",
        why: "போலி உதவி எண்கள் உங்கள் தொலைபேசி அல்லது கணினியின் கட்டுப்பாட்டையும், பிறகு உங்கள் வங்கிக் கணக்கையும் கைப்பற்ற முயல்கின்றன.",
        steps: ["எந்த செயலியையும் நிறுவாதீர்கள், உங்கள் திரையைப் பகிராதீர்கள்.", "உங்கள் கார்டு, பில் அல்லது அதிகாரப்பூர்வ இணையதளத்தில் உள்ள எண்ணை அழையுங்கள்."],
      },
      money_request: {
        found: "யாரோ உங்களிடம் பணம் அனுப்பச் சொல்கிறார்கள்.",
        why: "மோசடிக்காரர்கள் குடும்பத்தினர், நண்பர்கள் அல்லது அதிகாரிகள் போல நடித்து அவசரமாகப் பணம் கேட்கிறார்கள்.",
        steps: ["இப்போது பணம் அனுப்பாதீர்கள்.", "உங்களுக்குத் தெரிந்த எண்ணில் அந்த நபரை அழைத்து, அது உண்மையில் அவர்தானா என்று சரிபாருங்கள்."],
      },
      message: {
        found: "இந்தச் செய்தியில் மோசடியின் அறிகுறிகள் உள்ளன.",
        why: "மோசடிச் செய்திகள் உங்களை அவசரப்படுத்தி, யோசிக்காமல் பணம் அல்லது விவரங்களைக் கொடுக்க வைக்கின்றன.",
        steps: ["பதில் அனுப்பாதீர்கள், இணைப்புகளைத் தொடாதீர்கள், செய்தியில் உள்ள எண்களை அழைக்காதீர்கள்.", "உங்களுக்குத் தெரிந்த எண்ணில் உண்மையான அனுப்பியவரிடம் சரிபாருங்கள்."],
      },
      screenshot: {
        found: "இந்த ஸ்கிரீன்ஷாட்டில் மோசடியின் அறிகுறிகள் உள்ளன.",
        why: "படங்களையும் உரையாடல்களையும் போலியாக உருவாக்கலாம். யாரோ உங்களை ஏமாற்ற முயற்சிக்கலாம்.",
        steps: ["இப்போது இதன்படி எதுவும் செய்யாதீர்கள்.", "உங்களுக்குத் தெரிந்த எண்ணில் உண்மையான நபர் அல்லது நிறுவனத்திடம் சரிபாருங்கள்."],
      },
    },
    labels: {
      found: "நாங்கள் கண்டது",
      why: "இது ஏன் ஆபத்தாக இருக்கலாம்",
      todo: "இப்போது என்ன செய்வது",
      trust: "நம்பிக்கையான ஒருவரிடம் கேளுங்கள்",
      more: "மேலும் பாதுகாப்பு விவரங்கள்",
      noteLow: "பணம் செலுத்தும் முன் அல்லது விவரங்களைப் பகிரும் முன், உண்மையான வங்கி அல்லது நிறுவனத்திடம் நீங்களே சரிபாருங்கள்.",
      noteUnsure: "எதையும் செய்யும் முன், உண்மையான வங்கி அல்லது நிறுவனத்திடம் சரிபாருங்கள், அல்லது நம்பிக்கையான ஒருவரிடம் கேளுங்கள்.",
    },
    family: {
      title: "நம்பிக்கையான ஒருவரிடம் கேளுங்கள்",
      intro: "இன்னொருவரின் பார்வை பல மோசடிகளைத் தடுக்கும். இதைப் பாதுகாப்பாகச் செய்யும் வழி இதோ.",
      points: [
        "பணம் அனுப்பும் முன், உங்களுக்கு ஏற்கனவே தெரிந்த எண்ணில் நம்பிக்கையான ஒருவரை அழையுங்கள்.",
        "சந்தேகத்திற்குரிய செய்திகளில் கொடுக்கப்பட்ட தொலைபேசி எண்களைப் பயன்படுத்தாதீர்கள்.",
        "வங்கி தொடர்பான கோரிக்கைகளை, உங்கள் வங்கியின் அதிகாரப்பூர்வ தொடர்பு விவரங்களைக் கொண்டு சரிபாருங்கள்.",
        "உங்களிடம் என்ன செய்யச் சொன்னார்கள் என்பதை அவர்களிடம் சொல்லுங்கள். உங்கள் OTP, PIN அல்லது கடவுச்சொல்லை குடும்பத்தினரிடமும் சொல்லாதீர்கள்.",
        "அவசரப்படாதீர்கள். நீங்கள் சரிபார்க்கும் வரை உண்மையான வங்கி அல்லது நிறுவனம் காத்திருக்கும்.",
      ],
      footer: "Prevenza உங்களுக்காக யாரையும் தொடர்புகொள்ளாது. தொலைபேசி எண்களைச் சேமிக்காது, செய்திகளை அனுப்பாது.",
      show: "நம்பிக்கையான ஒருவரிடம் கேளுங்கள்",
      hide: "இந்த வழிகாட்டியை மூடு",
    },
  };

  function deepFreeze(o) {
    Object.values(o).forEach((v) => {
      if (v && typeof v === "object") deepFreeze(v);
    });
    return Object.freeze(o);
  }

  return deepFreeze({ en, hi, ta });
});

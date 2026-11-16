/*
 * Prevenza: message scanner RULES. Data and phrase patterns only; the logic is in message-scan.js.
 * Everything here is configurable and runs on the device. Nothing is sent anywhere.
 *
 * How a signal works
 *   - A signal is one kind of warning sign (for example "asks you to share an OTP").
 *   - It never fires on a single common word. Every pattern needs two or more words that belong together
 *     (a request verb near a secret code, an agency near a threat, a KYC word near "update", and so on).
 *   - Each signal reports ONE weight no matter how many times it matches, so repeating a phrase never raises the score.
 *   - "negate" lists the wording that turns a match into reassurance ("Do not share your OTP" is a bank's own advice).
 *
 * Pattern sets (the language the pattern is written for)
 *   en  English words and common Roman-letter terms (always on)
 *   hi  Devanagari script (on when the text contains Devanagari)
 *   ta  Tamil script (on when the text contains Tamil)
 *   hr  Hindi written in English letters, "Hinglish"
 *   tr  Tamil written in English letters
 * All text is lowercased and cleaned before matching (see normalize in message-scan.js), so write patterns in lowercase.
 * Indian-language patterns use word stems because these languages add endings to words. Avoid \b next to Indian letters:
 * JavaScript treats them as non-word characters.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.messageRules = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  // ---------------------------------------------------------------- building blocks
  const SP = String.raw`[\s.\-]?`;
  // "Up to n characters inside one sentence" (stops at . ! ? a new line or the Hindi full stop).
  const g = (n) => String.raw`[^.!?\n\u0964]{0,${n}}?`;

  // Secret codes, in English letters. "pin code" (a postal code) is not a secret.
  const OTP_L = String.raw`(?:o${SP}t${SP}p|one[\s-]?time[\s-]?(?:password|pin|code|passcode)|verification\s+code|security\s+code|login\s+code|secret\s+code|(?:upi|atm|debit|credit|card|net[\s-]?banking|login)[\s-]?pin|m[\s-]?pin|pin(?!\s*code)|cvv|cvc|passwords?|passcode)`;
  const OTP_HI = String.raw`(?:ओ[\s.]?टी[\s.]?पी|वन[\s-]?टाइम[\s-]?पासवर्ड|पिन(?!\s*कोड)|सीवीवी|पासवर्ड|वेरिफिकेशन\s*कोड|सिक्योरिटी\s*कोड)`;
  const OTP_TA = String.raw`(?:[ஒஓ][\s.]?டி[\s.]?பி|யுபிஐ\s*பின|ஏடிஎம்\s*பின|பின்\s*நம்பர|பாஸ்வேர்ட|கடவுச்சொல|சிவிவி|ஒரு\s*முறை\s*கடவுச்சொல)`;

  const SHARE_L = String.raw`(?:share|send|tell|give|provide|forward|read\s+out|reveal|disclose|dictate|whatsapp)`;
  const SHARE_HI = String.raw`(?:बता|भेज|शेयर|साझा|दे\s*द|दीजिए|दीजिये|बोल|सुना)`;
  const SHARE_TA = String.raw`(?:சொல|அனுப்ப|அனுப்பு|பகிர|கொடு|தெரிவி|தாருங்கள|வழங்க|கூற)`;
  const SHARE_HR = String.raw`(?:bata\w*|bhej\w*|share|send|de\s*do|dena|dijiye\w*|sunao|bol\s*do|bolo|likh\w*|batayen|batayein)`;
  const SHARE_TR = String.raw`(?:sollu\w*|solli\w*|solren|anupp\w*|kodu\w*|kud\w*|tharu\w*|share|send|podu\w*)`;

  // KYC ("know your customer").
  const KYC_L = String.raw`(?:k${SP}y${SP}c|know\s+your\s+customer)`;
  const KYC_HI = String.raw`(?:केवाईसी|के\s*वाई\s*सी|के\.वाई\.सी|केवायसी|केवाइसी|नो\s*योर\s*कस्टमर|k${SP}y${SP}c)`;
  const KYC_TA = String.raw`(?:கேவைசி|கே\s*ஒய்\s*சி|கே\.ஒய்\.சி|கேஒய்சி|கேஓய்சி|கே\.வை\.சி|k${SP}y${SP}c)`;

  // Agencies that scammers pretend to be.
  const AUTH_L = String.raw`(?:cbi|ncb|enforcement\s+directorate|customs|cyber\s*(?:crime|cell|police)|police|narcotics|trai|rbi|income\s*tax|court|interpol|crime\s+branch|immigration)`;
  const AUTH_HI = String.raw`(?:सीबीआई|पुलिस|साइबर\s*क्राइम|कस्टम|नारकोटिक्स|ईडी|प्रवर्तन\s*निदेशालय|आयकर|अदालत|कोर्ट|ट्राई|आरबीआई|क्राइम\s*ब्रांच)`;
  const AUTH_TA = String.raw`(?:சிபிஐ|காவல|போலீஸ|சைபர்\s*கிரைம|சுங்க|போதைப்பொருள|அமலாக்க|வருமான\s*வரி|நீதிமன்ற|கோர்ட|ரிசர்வ்\s*வங்கி|ஆர்பிஐ)`;

  const CARE_L = String.raw`(?:customer\s*(?:care|support|service)|help\s*line|toll[\s-]?free|care\s+executive|support\s+(?:team|desk|number)|(?:technical|tech)\s+support)`;
  const CARE_HI = String.raw`(?:कस्टमर\s*केयर|कस्टमर\s*सपोर्ट|हेल्पलाइन|ग्राहक\s*(?:सेवा|सहायता)|टोल\s*फ्री)`;
  const CARE_TA = String.raw`(?:கஸ்டமர்\s*கேர|கஸ்டமர்\s*சப்போர்ட|வாடிக்கையாளர்\s*(?:சேவை|ஆதரவு)|ஹெல்ப்லைன|உதவி\s*எண|டோல்\s*ஃப்ரீ)`;

  // An Indian mobile number (ten digits starting 6 to 9, with or without +91). Toll-free 1800 numbers do not match.
  const PHONE = String.raw`(?:\+?91[\s-]?)?(?<!\d)[6-9]\d{4}[\s-]?\d{5}(?!\d)`;

  // UPI addresses end in a known bank or app name.
  const UPI_ID = String.raw`[a-z0-9._\-]{2,}@(?:ok(?:sbi|hdfcbank|icici|axis)|ybl|ibl|axl|paytm|apl|upi|sbi|icici|hdfcbank|axisbank|fbl|barodampay|postbank|ikwik|freecharge|pingpay|yesbank|kotak|pnb|cnrb|unionbank|idfcfirst|jupiter|airtel|jio)`;

  // ---------------------------------------------------------------- wording that cancels or softens a match
  // "before" is tested on the 45 characters before the match plus the match. "after" is tested on the text right after it.
  const NEG_BEFORE_SECRET = String.raw`\b(?:do\s*not|don'?t|dont|never|not\s+to|should\s*not|shouldn'?t|will\s+not|won'?t|no\s+one|nobody|avoid|beware|no\s+need)\b|कभी|(?:^|\s)(?:न|ना)\s*(?:कर|बता|भेज|दे)|नहीं|(?:^|\s)मत(?=\s|[,.!\u0964]|$)|கூடாது|வேண்டாம|ஒருபோதும|\b(?:mat|nahi|nahin|kabhi|vendam|vendaam|koodathu|kudathu)\b`;
  const NEG_AFTER_SECRET = String.raw`^[\s,.\-:;]{0,3}(?:(?:न|ना)\s*(?:कर|बता|भेज|दे)|नहीं|मत(?=\s|[,.!\u0964]|$)|வேண்டாம|கூடாது|(?:mat|nahi|nahin|vendam|koodathu|na\s+kar\w*)\b)`;
  // Awareness messages: "digital arrest is a scam". The phrase is still shown, but only as a note.
  const NEG_BEFORE_AWARE = String.raw`\b(?:scams?|frauds?|beware|cheat\w*|never|no\s+such|not\s+a|awareness|myth|dhokha|thagi|sawdhan|mosadi)\b|ठगी|धोखा|फर्जी|जागरूक|सावधान|(?<!பண)மோசடி|போலி|விழிப்புணர்வு`;
  const NEG_AFTER_AWARE = String.raw`^${g(30)}(?:\b(?:scam|fraud|cheating|myth|not\s+real|doesn'?t\s+exist|does\s+not\s+exist)\b|ठगी|धोखा|फर्जी|(?<!பண)மோசடி|போலி)`;
  // A KYC message that reports something already done is a receipt, not a request.
  const NEG_BEFORE_DONE = String.raw`\b(?:success\w*|completed|approved|verified|accepted|updated|thank\s+you|thanks\s+for|safal|vetrikaramaga)\b|सफल|வெற்றிகரமாக`;
  const NEG_AFTER_DONE = String.raw`^${g(30)}(?:\b(?:success\w*|completed|approved|verified|accepted|done|received|ho\s+gaya|ho\s+chuka|mudinjadhu|mudinthathu)\b|सफल|हो\s*गया|हो\s*चुका|स्वीकृत|வெற்றிகரமாக|முடிந்தது|முடிக்கப்பட்டது)`;
  // A block the customer asked for is normal.
  const NEG_BEFORE_REQUESTED = String.raw`\b(?:not\s+you|wasn'?t\s+you|was\s+not\s+you|unauthori[sz]ed|did\s+not\s+(?:make|do|authori[sz]e|initiate)|didn'?t\s+(?:make|do|authori[sz]e|initiate)|to\s+(?:block|freeze|report)|request(?:ed)?\s+(?:to|for))\b`;
  const NEG_AFTER_REQUESTED = String.raw`^${g(45)}\b(?:as\s+(?:per\s+)?(?:you\s+)?requested|at\s+your\s+request|per\s+your\s+request|on\s+your\s+request)\b|^${g(30)}(?:अनुरोध|आपके\s*कहने)`;

  // ---------------------------------------------------------------- the signals
  const SIGNALS = Object.freeze([
    // ---- digital arrest and official-impersonation threats
    {
      id: "msg_digital_arrest",
      categories: ["digital_arrest"],
      weight: 8,
      critical: true,
      label: "Mentions a \"digital arrest\"",
      why: "There is no such thing as a digital arrest. Police and courts never arrest anyone over a call or a video call, and never ask for money to close a case.",
      negate: { before: NEG_BEFORE_AWARE, after: NEG_AFTER_AWARE, weight: 1.5 },
      patterns: {
        en: [String.raw`\bdigital[\s-]*arrest\w*`],
        hi: [String.raw`डिजिटल\s*(?:अरेस्ट|गिरफ्तार)`],
        ta: [String.raw`டிஜிட்டல்\s*(?:கைது|அரெஸ்ட)`],
        hr: [String.raw`\bdigital\s*(?:girftar\w*|giraftar\w*)`],
        tr: [String.raw`\bdigital\s*(?:kaidhu|kaithu|kaidu)\b`],
      },
    },
    {
      id: "msg_authority_threat",
      categories: ["digital_arrest"],
      weight: 4.5,
      label: "Threatens arrest or a case in the name of the police or an agency",
      why: "Scammers pretend to be police, customs or other officers to frighten people. Real officers do not demand money or secrecy over a call or a message.",
      negate: { before: NEG_BEFORE_AWARE, after: NEG_AFTER_AWARE, weight: 0 },
      // A threat only counts when it is aimed at the reader ("your Aadhaar", "you"). "Police arrested two men" is just news.
      patterns: {
        en: [
          String.raw`\b${AUTH_L}\b(?=[^.!?\n]{0,160}\b(?:you|your|aadhaar|aadhar|sim|parcel|account|number)\b)${g(60)}\b(?:arrest\w*|warrant|fir|case\s+(?:has\s+been\s+|is\s+|was\s+)?(?:registered|filed|lodged|against)|money\s+laundering|illegal|drugs?|seized|custody|jail|criminal)\b`,
          String.raw`\b(?:arrest\w*|warrant)\b(?=[^.!?\n]{0,80}\b(?:you|your|aadhaar|aadhar|sim|parcel|account|number)\b)${g(40)}\b${AUTH_L}\b`,
        ],
        hi: [String.raw`${AUTH_HI}(?=[^.!?\n\u0964]{0,160}(?:आप|आधार|सिम|पार्सल|खाते|खाता|नंबर))${g(60)}(?:गिरफ्तार|वारंट|एफआईआर|केस|मामला\s*दर्ज|ड्रग|मनी\s*लॉन्डरिंग|अवैध|जेल)`],
        ta: [String.raw`${AUTH_TA}(?=[^.!?\n]{0,160}(?:நீங்கள|உங்கள|ஆதார|சிம(?:்|ை)|பார்சல|கணக்க|எண))${g(60)}(?:கைது|வாரண்ட|எஃப்ஐஆர|வழக்க|சட்டவிரோத|போதை|பணமோசடி|சிறை)`],
        hr: [String.raw`\b${AUTH_L}\b(?=[^.!?\n]{0,160}\b(?:aap|aapka|aapke|aapki|aadhaar|aadhar|sim|parcel|account|number)\b)${g(60)}\b(?:girftar\w*|giraftar\w*|kaid\w*|jurm|case\s+darj)\b`],
        tr: [String.raw`\b${AUTH_L}\b(?=[^.!?\n]{0,160}\b(?:unga\w*|neenga|aadhaar|aadhar|sim|parcel|account|number)\b)${g(60)}\b(?:kaidhu|kaithu|vazhakku|case\s+poda\w*|warrant)\b`],
      },
    },
    {
      id: "msg_isolation",
      categories: ["digital_arrest"],
      weight: 2.5,
      label: "Tells you to keep this secret or stay on the call",
      why: "Scammers cut people off from family so nobody can say it looks wrong. A real organisation never asks you to keep a matter secret.",
      patterns: {
        en: [
          String.raw`\b(?:do\s*not|don'?t|never)\s+(?:tell|inform|discuss(?:\s+this)?\s+with|speak\s+to)\s+(?:this\s+to\s+)?(?:anyone|anybody|any\s+one|your\s+family|family|friends|others)\b`,
          String.raw`\b(?:keep|stay)\b${g(25)}\b(?:confidential|secret)\b`,
          String.raw`\b(?:stay|remain)\s+(?:on\s+)?(?:the\s+)?(?:video\s+)?(?:call|line)\b`,
          String.raw`\b(?:do\s*not|don'?t)\s+(?:disconnect|cut|hang\s*up|end)\s+(?:the\s+)?(?:video\s+)?call\b`,
        ],
        hi: [String.raw`किसी\s*को\s*(?:भी\s*)?(?:न|ना|मत)\s*बता`, String.raw`कॉल\s*(?:मत|ना|न)\s*(?:काट|डिस्कनेक्ट)`, String.raw`वीडियो\s*कॉल\s*(?:पर|में)\s*(?:बने\s*रहें|रहें)`],
        ta: [String.raw`யாரிடமும்\s*(?:சொல்ல\s*வேண்டாம|சொல்லாதீர|சொல்லக்கூடாது|தெரிவிக்க\s*வேண்டாம)`, String.raw`அழைப்பை\s*(?:துண்டிக்க\s*வேண்டாம|துண்டிக்காதீர)`, String.raw`வீடியோ\s*கால்\s*(?:இல|ல)?\s*(?:இருங்கள|இருக்க)`],
        hr: [String.raw`\bkisi\s*(?:ko|se)\s*(?:bhi\s*)?(?:mat|na|nahi)\s*(?:bata\w*|bol\w*)`, String.raw`\bcall\s*(?:mat|na|nahi)\s*(?:kat\w*|disconnect)`, String.raw`\bvideo\s*call\s*(?:par|pe)\s*(?:bane\s*rahe\w*|rahe\w*|raho)`],
        tr: [String.raw`\byaridamum\s*(?:solla\w*|sollathinga|sollaadhinga|sollidatheenga)`, String.raw`\byarukkum\s*(?:solla\w*|sollathinga|sollaadhinga)`, String.raw`\bcall\s*(?:cut|disconnect)\s*(?:panna\w*|pannathinga|pannaadhinga)`],
      },
    },
    {
      id: "msg_safe_account",
      categories: ["urgent_transfer"],
      weight: 8,
      critical: true,
      label: "Asks you to move money to a \"safe\" or \"government\" account",
      why: "No bank or agency keeps a safe account for your money. Money sent to one goes straight to the scammer.",
      negate: { before: NEG_BEFORE_AWARE, after: NEG_AFTER_AWARE, weight: 1.5 },
      patterns: {
        en: [
          String.raw`\b(?:safe|secure|rbi|government|verification|temporary|escrow|supervision)\s+account\b${g(50)}\b(?:transfer|send|deposit|move|pay)\w*`,
          String.raw`\b(?:transfer|send|deposit|move|pay)\w*\b${g(50)}\b(?:safe|secure|rbi|government|verification|temporary|escrow|supervision)\s+account\b`,
        ],
        hi: [String.raw`(?:सुरक्षित|आरबीआई|सरकारी|वेरिफिकेशन|अस्थायी)\s*(?:खाते|खाता|अकाउंट)${g(40)}(?:ट्रांसफर|भेज|जमा)`],
        ta: [String.raw`(?:பாதுகாப்பான|ஆர்பிஐ|அரசு|சரிபார்ப்பு)\s*(?:கணக்க|அக்கவுண்ட)${g(40)}(?:மாற்ற|அனுப்ப|செலுத்த|டெபாசிட)`],
        hr: [String.raw`\b(?:safe|secure|rbi|sarkari|verification)\s+(?:khate|khata|account)\b${g(40)}\b(?:transfer|bhej\w*|jama|dal\w*)\b`],
        tr: [String.raw`\b(?:safe|secure|rbi|government|verification)\s+account\b${g(40)}\b(?:transfer|anupp\w*|podu\w*|kattu\w*)\b`],
      },
    },

    // ---- OTP, PIN and personal details
    {
      id: "msg_otp_request",
      categories: ["otp_pin"],
      weight: 6,
      label: "Asks you to share an OTP, PIN or password",
      why: "An OTP or PIN is only for you. A real bank or company never asks you to tell, send or read it out, even over a call or a message.",
      negate: { before: NEG_BEFORE_SECRET, after: NEG_AFTER_SECRET, weight: 0 },
      patterns: {
        en: [String.raw`\b${SHARE_L}\b${g(30)}\b${OTP_L}\b`, String.raw`\b${OTP_L}\b${g(25)}\b${SHARE_L}\b`],
        hi: [String.raw`${OTP_HI}${g(40)}${SHARE_HI}`, String.raw`${SHARE_HI}${g(15)}${OTP_HI}`],
        ta: [String.raw`${OTP_TA}${g(40)}${SHARE_TA}`, String.raw`${SHARE_TA}${g(15)}${OTP_TA}`],
        hr: [String.raw`\b${OTP_L}\b${g(40)}\b${SHARE_HR}\b`, String.raw`\b(?:bata\w*|bhej\w*|share|send)\b${g(25)}\b${OTP_L}\b`],
        tr: [String.raw`\b${OTP_L}\b${g(40)}\b${SHARE_TR}\b`],
      },
    },
    {
      id: "msg_credentials_request",
      categories: ["otp_pin"],
      weight: 2.5,
      label: "Asks for card, bank or ID details",
      why: "Banks do not ask for card numbers, Aadhaar, PAN or login details through a message or a call.",
      negate: { before: NEG_BEFORE_SECRET, after: NEG_AFTER_SECRET, weight: 0 },
      patterns: {
        en: [String.raw`\b(?:share|send|provide|enter|update|submit|confirm|give|verify|reply\s+with)\b${g(30)}\b(?:aadhaar|aadhar|pan(?:\s*card)?|card\s*(?:number|no\.?|details)|(?:debit|credit)\s*card|expiry(?:\s*date)?|net\s*banking|internet\s*banking|login\s*(?:id|details|credentials)|user\s*id|account\s*(?:number|no\.?|details)|ifsc|date\s+of\s+birth|dob)\b`],
        hi: [String.raw`(?:आधार|पैन|कार्ड\s*(?:नंबर|विवरण)|एक्सपायरी|नेट\s*बैंकिंग|लॉगिन|खाता\s*(?:संख्या|नंबर)|जन्म\s*तिथि)${g(30)}(?:बता|भेज|शेयर|साझा|दर्ज|अपडेट|दीजिए|दीजिये)`],
        ta: [String.raw`(?:ஆதார|பான|கார்டு\s*(?:எண|விவரங்கள)|காலாவதி\s*தேதி|நெட்\s*பேங்கிங|கணக்கு\s*எண|பிறந்த\s*தேதி)${g(30)}(?:சொல்ல|அனுப்ப|பகிர|உள்ளிட|பதிவு|புதுப்பி|கொடு)`],
        hr: [String.raw`\b(?:aadhaar|aadhar|pan|card\s*(?:number|no\.?|details)|expiry|net\s*banking|account\s*(?:number|no\.?|details)|dob)\b${g(30)}\b(?:bata\w*|bhej\w*|share|send|dijiye\w*|update|enter|darj|dalen|dena)\b`],
        tr: [String.raw`\b(?:aadhaar|aadhar|pan|card\s*(?:number|no\.?|details)|expiry|net\s*banking|account\s*(?:number|no\.?|details)|dob)\b${g(30)}\b(?:sollu\w*|anupp\w*|share|send|update|enter|kodu\w*|kud\w*)\b`],
      },
    },
    {
      id: "msg_remote_access",
      categories: ["customer_care"],
      weight: 5,
      label: "Mentions an app that lets someone control your phone",
      why: "Apps such as AnyDesk or TeamViewer let another person see and control your screen. Scammers use them to empty bank accounts. Do not install one because a stranger asks.",
      patterns: {
        en: [String.raw`\b(?:any\s*desk|team\s*viewer|quick\s*support|rust\s*desk|ammyy|alpemix|aweray)\b`],
        hi: [String.raw`(?:एनी\s*डेस्क|टीम\s*व्यूअर|टीमव्यूवर)`],
        ta: [String.raw`(?:அனிடெஸ்க|டீம்\s*வியூவர)`],
        hr: [],
        tr: [],
      },
    },

    // ---- KYC, account threats, impersonation
    {
      id: "msg_kyc_update",
      categories: ["fake_kyc"],
      weight: 3,
      label: "Says your KYC is pending or must be updated",
      why: "Scammers use \"KYC update\" as a reason to get your details. Banks usually ask for KYC at a branch or in their official app, not through a link in a message.",
      negate: { before: NEG_BEFORE_DONE, after: NEG_AFTER_DONE, weight: 0 },
      patterns: {
        en: [
          String.raw`\b${KYC_L}\b${g(50)}\b(?:updat\w*|expir\w*|pending|incomplete|verif\w*|complet\w*|block\w*|suspend\w*|due|mandatory|required|lapse\w*|deactivat\w*|renew\w*|resubmit\w*|invalid|failed)\b`,
          String.raw`\b(?:updat\w*|verif\w*|complet\w*|renew\w*|submit\w*)\b${g(20)}\b${KYC_L}\b`,
        ],
        hi: [
          String.raw`${KYC_HI}${g(50)}(?:अपडेट|अधूरा|अधूरी|पूरा|पूरी|समाप्त|एक्सपायर|बंद|ब्लॉक|वेरीफाई|वेरिफाई|सत्यापन|सत्यापित|लंबित|जरूरी|अनिवार्य|निलंबित)`,
          String.raw`(?:अपडेट|वेरीफाई|वेरिफाई)${g(20)}${KYC_HI}`,
        ],
        ta: [
          String.raw`${KYC_TA}${g(50)}(?:புதுப்பி|முடிக்க|முடியாத|காலாவதி|நிலுவை|சரிபார|தடை|முடக்க|கட்டாயம|தேவை|நிறைவு)`,
          String.raw`(?:புதுப்பி|சரிபார)${g(20)}${KYC_TA}`,
        ],
        hr: [String.raw`\b${KYC_L}\b${g(50)}\b(?:update|adhura|adhuri|pura|puri|expire\w*|band|block|verify|verification|pending|zaruri|jaruri|anivarya|karwa\w*|karen|karein|kare|kijiye|karna|karo)\b`],
        tr: [String.raw`\b${KYC_L}\b${g(50)}\b(?:update|mudiya\w*|puthuppi\w*|expire\w*|block|pending|kattayam|seyya\w*|panna\w*|pannunga|pannanum|verify)\b`],
      },
    },
    {
      id: "msg_account_block",
      categories: ["account_suspension"],
      weight: 2,
      label: "Warns that your account, card or SIM will be blocked",
      why: "Threats of blocking are used to rush people into acting without thinking. A real bank asks you to visit the branch or use its own app.",
      negate: { before: NEG_BEFORE_REQUESTED, after: NEG_AFTER_REQUESTED, weight: 0 },
      patterns: {
        en: [
          String.raw`\b(?:bank\s+)?(?:account|a\/c|acct|card|credit\s+card|debit\s+card|upi(?:\s+id)?|wallet|sim(?:\s+card)?|mobile\s+number|aadhaar|aadhar|pan(?:\s+card)?|net\s*banking|electricity\s+(?:connection|supply))\b${g(45)}\b(?:block(?:ed)?|suspend(?:ed)?|clos(?:ed|ure)|freez\w*|frozen|deactivat\w*|disabl\w*|restrict\w*|terminat\w*|cancel\w*|lock(?:ed)?|disconnect\w*)\b`,
          String.raw`\b(?:block(?:ed)?|suspend(?:ed)?|freez\w*|frozen|deactivat\w*|disabl\w*|restrict\w*|terminat\w*|lock(?:ed)?)\b${g(20)}\b(?:account|a\/c|card|upi|wallet|sim|mobile\s+number)\b`,
        ],
        hi: [String.raw`(?:खाता|खाते|अकाउंट|कार्ड|सिम|मोबाइल\s*नंबर|आधार|पैन|बिजली\s*कनेक्शन)${g(40)}(?:ब(?:ंद|न्द)|ब्लॉक|सस्पेंड|फ्रीज|निलंबित|रद्द|डीएक्टिवेट|निष्क्रिय|लॉक|कट\s*जाए|कट\s*दिया)`],
        ta: [String.raw`(?:கணக்க|அக்கவுண்ட|கார்ட|சிம(?:்|ை)|மொபைல்\s*எண|ஆதார|பான|மின்\s*இணைப்பு)${g(40)}(?:முடக்க|தடை|ரத்து|நிறுத்த|பிளாக|ப்ளாக|சஸ்பெண்ட|செயலிழ|துண்டிக்க|லாக)`],
        hr: [String.raw`\b(?:khata|khate|account|a\/c|card|sim|aadhaar|aadhar|pan|bijli\s+connection|mobile\s+number)\b${g(40)}\b(?:band|block|suspend|freeze|frozen|rok\w*|nilambit|radd|deactivate\w*|lock|disconnect)\w*`],
        tr: [String.raw`\b(?:account|kanakku|card|sim|aadhaar|aadhar|pan|mobile\s+number|eb\s+connection)\b${g(40)}\b(?:block|mudakk\w*|nirutth\w*|niruth\w*|suspend|close|freeze|ratthu|cancel|disconnect|deactivate)\w*`],
      },
    },
    {
      id: "msg_authority_impersonation",
      categories: ["impersonation"],
      weight: 2,
      label: "Claims to be from a bank or a government office",
      why: "Anyone can say they are from a bank or the government. Check by calling the number printed on your card or shown on the official website.",
      patterns: {
        en: [String.raw`\b(?:this\s+is|i\s+am|i'?m|calling\s+from|speaking\s+from|message\s+from|officer\s+from|executive\s+from)\b${g(40)}\b(?:sbi|hdfc|icici|axis|pnb|bank|rbi|income\s*tax|cbi|police|customs|trai|uidai|aadhaar|epfo|telecom|department)\b`],
        hi: [String.raw`(?:बैंक|आरबीआई|सीबीआई|पुलिस|एसबीआई|विभाग)\s*(?:से|के)?\s*(?:बोल\s*रहा|बोल\s*रही|अधिकारी|मैनेजर|कर्मचारी|एक्जीक्यूटिव)`],
        ta: [String.raw`(?:வங்கி|ஆர்பிஐ|சிபிஐ|காவல|எஸ்பிஐ|துறை)${g(20)}(?:இருந்து|அதிகாரி|மேலாளர|பேசுகிறேன)`],
        hr: [String.raw`\b(?:main|mai|mein|hum)\b${g(30)}\b(?:bank|rbi|cbi|police|sbi|hdfc|icici|customs|vibhag)\b${g(20)}\b(?:se|ka|ke)\b${g(15)}\b(?:bol\w*|officer|manager|adhikari|executive)\b`],
        tr: [String.raw`\b(?:naan|nan)\b${g(30)}\b(?:bank|rbi|cbi|police|sbi|hdfc|icici|customs)\b${g(20)}\b(?:irundhu|officer|manager|pesuren|pesukiren)\w*`],
      },
    },

    // ---- parcels, prizes, fees
    {
      id: "msg_parcel_fee",
      categories: ["parcel_fee"],
      weight: 4.5,
      label: "Asks for a small fee to release or deliver a parcel",
      why: "Fake courier messages ask for a small fee so they can take your card or UPI details. Check any parcel in the courier's official app.",
      patterns: {
        en: [
          String.raw`\b(?:parcel|package|consignment|shipment|courier|delivery|customs|dhl|fedex|india\s*post|blue\s*dart|bluedart|delhivery|dtdc|ecom\s*express|speed\s*post)\b${g(70)}\b(?:fees?|charges?|duty|duties|fine|penalty|tax)\b${g(50)}\b(?:pay|payable|pending|due|unpaid|settle|clear|submit|deposit|required)\b`,
          String.raw`\b(?:parcel|package|consignment|shipment|courier|delivery|customs|dhl|fedex|india\s*post|blue\s*dart|bluedart|delhivery|dtdc|ecom\s*express|speed\s*post)\b${g(70)}\b(?:pay|payable|settle|clear|submit|deposit)\b${g(40)}\b(?:fees?|charges?|duty|duties|fine|penalty|tax)\b`,
          String.raw`\b(?:pay|settle|clear)\b${g(30)}\b(?:fees?|charges?|duty|duties|fine|penalty)\b${g(60)}\b(?:parcel|package|consignment|shipment|courier|delivery)\b`,
        ],
        hi: [
          String.raw`(?:पार्सल|कूरियर|डिलीवरी|पैकेज|कस्टम|शिपमेंट)${g(70)}(?:शुल्क|फीस|चार्ज|ड्यूटी|जुर्माना|टैक्स)${g(50)}(?:भुगतान|जमा|देना|चुकाना|चुकाएं|भरें|बकाया|पेमेंट|अदा)`,
          String.raw`(?:पार्सल|कूरियर|डिलीवरी|पैकेज|कस्टम|शिपमेंट)${g(70)}(?:भुगतान|जमा|चुकाएं|भरें|पेमेंट)${g(40)}(?:शुल्क|फीस|चार्ज|ड्यूटी|जुर्माना|टैक्स)`,
        ],
        ta: [
          String.raw`(?:பார்சல|கூரியர|டெலிவரி|பொட்டலம|சுங்க|ஷிப்மென்ட)${g(70)}(?:கட்டண|வரி|அபராதம|டியூட்டி|சார்ஜ)${g(50)}(?:செலுத்த|கட்ட|நிலுவை|பாக்கி)`,
          String.raw`(?:பார்சல|கூரியர|டெலிவரி|பொட்டலம|சுங்க|ஷிப்மென்ட)${g(70)}(?:செலுத்த|கட்ட)${g(40)}(?:கட்டண|வரி|அபராதம|டியூட்டி|சார்ஜ)`,
        ],
        hr: [
          String.raw`\b(?:parcel|package|courier|delivery|customs|shipment)\b${g(70)}\b(?:fees?|charges?|duty|shulk|jurmana|tax)\b${g(50)}\b(?:pay|payment|bhugtan|jama|bharen|bharna|dena|chukana|chukayen|baki|pending|due|karen|karein|karna|kijiye)\b`,
          String.raw`\b(?:parcel|package|courier|delivery|customs|shipment)\b${g(70)}\b(?:pay|payment|bhugtan|jama|bharen|bharna|chukayen)\b${g(40)}\b(?:fees?|charges?|duty|shulk|jurmana|tax)\b`,
        ],
        tr: [
          String.raw`\b(?:parcel|package|courier|delivery|customs|shipment)\b${g(70)}\b(?:fees?|charges?|duty|kattanam|vari|abaradham|tax)\b${g(50)}\b(?:pay|payment|kattu\w*|kattanum|pending|due|seluttu\w*|selutha\w*)\b`,
          String.raw`\b(?:parcel|package|courier|delivery|customs|shipment)\b${g(70)}\b(?:pay|payment|kattu\w*|seluttu\w*)\b${g(40)}\b(?:fees?|charges?|duty|kattanam|vari|abaradham|tax)\b`,
        ],
      },
    },
    {
      id: "msg_prize_claim",
      categories: ["prize"],
      weight: 3,
      label: "Says you have won a lottery or prize",
      why: "You cannot win a lottery or draw that you never entered. Real prizes never ask you to pay first.",
      patterns: {
        en: [
          String.raw`\b(?:congratulations?|congrats)\b${g(60)}\b(?:won|win|winner|selected|lucky|lottery|jackpot)\b`,
          String.raw`\byou(?:'ve|\s+have|\s+are|\s+were)?\s+(?:won|selected|chosen)\b${g(50)}\b(?:lottery|lucky\s+draw|jackpot|lakhs?|crores?|iphone|bmw)\b`,
          String.raw`\b(?:lottery|lucky\s+draw|jackpot|kbc)\b${g(60)}\b(?:won|winner|claim|selected|congratulations)\b`,
        ],
        hi: [
          String.raw`(?:बधाई|मुबारक)${g(60)}(?:जीत|इनाम|लॉटरी|विजेता|चुने)`,
          String.raw`(?:लॉटरी|इनाम|जैकपॉट|लकी\s*ड्रॉ|केबीसी)${g(60)}(?:जीत|विजेता|चुने|क्लेम)`,
        ],
        ta: [
          String.raw`(?:வாழ்த்துக்கள|வாழ்த்துகள)${g(60)}(?:வென்ற|பரிசு|லாட்டரி|வெற்றி|தேர்வு)`,
          String.raw`(?:லாட்டரி|ஜாக்பாட|லக்கி\s*டிரா|கேபிசி)${g(60)}(?:வென்ற|வெற்றி|பெற|தேர்வு)`,
        ],
        hr: [
          String.raw`\b(?:badhai|mubarak)\b${g(60)}\b(?:jeet\w*|inaam|lottery|winner|chun\w*)\b`,
          String.raw`\b(?:aapne|aap\s+ne)\b${g(40)}\b(?:lottery|inaam|jackpot|lucky\s+draw)\b`,
        ],
        tr: [
          String.raw`\b(?:vaazhthukkal|valthukkal)\b${g(60)}\b(?:parisu|lottery|jeyitha\w*|vetri|winner)\b`,
          String.raw`\b(?:lottery|parisu|jackpot)\b${g(60)}\b(?:vendr\w*|vetri|jeyith\w*|winner)\b`,
        ],
      },
    },
    {
      id: "msg_advance_fee",
      categories: ["prize"],
      weight: 4,
      label: "Asks you to pay a fee before you receive money or a prize",
      why: "A real prize, refund or loan never needs a fee paid first. This is a common way to take your money.",
      patterns: {
        en: [
          String.raw`\b(?:pay|send|deposit|transfer|submit)\b${g(40)}\b(?:processing|registration|release|claim|clearance|insurance|gst|tax|handling|admin\w*)\s*(?:fees?|charges?|tax|amount)\b${g(60)}\b(?:claim|release|receive|prize|reward|refund|loan|lottery|gift|winning)\b`,
          String.raw`\b(?:processing|registration|release|claim|clearance|insurance|gst|tax|handling)\s*(?:fees?|charges?)\b${g(50)}\b(?:pay|send|deposit)\b${g(60)}\b(?:claim|release|receive|prize|reward|refund|loan|lottery|gift|winning)\b`,
        ],
        hi: [String.raw`(?:प्रोसेसिंग|रजिस्ट्रेशन|क्लेम|टैक्स|जीएसटी|बीमा)\s*(?:फीस|शुल्क|चार्ज)${g(40)}(?:जमा|भेज|भुगतान|भरें|दें)`],
        ta: [String.raw`(?:செயலாக்க|பதிவு|கிளைம|வரி|ஜிஎஸ்டி|காப்பீடு)\s*(?:கட்டண|வரி)${g(40)}(?:செலுத்த|அனுப்ப|கட்ட)`],
        hr: [String.raw`\b(?:processing|registration|claim|tax|gst|insurance)\s*(?:fees?|charges?|shulk)\b${g(40)}\b(?:jama|bhej\w*|pay|dena|bharna|bhugtan)\w*`],
        tr: [String.raw`\b(?:processing|registration|claim|tax|gst)\s*(?:fees?|charges?|kattanam)\b${g(40)}\b(?:kattu\w*|anupp\w*|pay|podu\w*|seluttu\w*)\w*`],
      },
    },

    // ---- fake customer care
    {
      id: "msg_customer_care",
      categories: ["customer_care"],
      weight: 1.5,
      label: "Tells you to call a \"customer care\" number given in the message",
      why: "Fake customer care numbers are placed in messages and search results. Find the real number on the official website or on your card.",
      patterns: {
        en: [
          String.raw`\b${CARE_L}\b${g(50)}(?:\+?\d[\d\s-]{6,}\d|\b(?:call|contact|dial|whatsapp)\b)`,
          String.raw`\b(?:call|contact|dial|whatsapp|reach)\b${g(30)}\b${CARE_L}\b`,
        ],
        hi: [String.raw`${CARE_HI}${g(50)}(?:\+?\d[\d\s-]{6,}\d|संपर्क|कॉल|फोन)`, String.raw`(?:संपर्क|कॉल)${g(25)}${CARE_HI}`],
        ta: [String.raw`${CARE_TA}${g(50)}(?:\+?\d[\d\s-]{6,}\d|தொடர்பு|அழை)`, String.raw`(?:தொடர்பு|அழை)${g(25)}${CARE_TA}`],
        hr: [String.raw`\b${CARE_L}\b${g(50)}\b(?:sampark|phone|karo|karen|kijiye)\b`],
        tr: [String.raw`\b${CARE_L}\b${g(50)}\b(?:call\s*pann\w*|thodarbu|phone|pannunga)\b`],
      },
    },
    {
      id: "msg_care_mobile_number",
      categories: ["customer_care"],
      weight: 3.5,
      label: "Gives an ordinary mobile number as \"customer care\"",
      why: "Banks and big companies use toll-free or landline numbers for customer care. An ordinary mobile number is a warning sign.",
      patterns: {
        en: [String.raw`\b${CARE_L}\b${g(70)}${PHONE}`, String.raw`${PHONE}${g(40)}\b${CARE_L}\b`],
        hi: [String.raw`${CARE_HI}${g(70)}${PHONE}`, String.raw`${PHONE}${g(40)}${CARE_HI}`],
        ta: [String.raw`${CARE_TA}${g(70)}${PHONE}`, String.raw`${PHONE}${g(40)}${CARE_TA}`],
        hr: [],
        tr: [],
      },
    },

    // ---- money requests and payment instructions
    {
      id: "msg_money_request",
      categories: ["urgent_transfer"],
      weight: 2.5,
      label: "Asks you to send money",
      why: "Be careful with requests to send money, especially urgent ones. Call the person on a number you already know before you pay.",
      patterns: {
        en: [
          String.raw`\b(?:please|pls|plz|kindly|urgently|urgent|immediately|asap|quickly)\b${g(40)}\b(?:send|transfer|lend|give|pay|gpay|paytm|phonepe)\b${g(30)}(?:\bmoney\b|\bamount\b|\bcash\b|₹\s*\d|\brs\.?\s*\d|\binr\s*\d|\b\d[\d,]{2,}\b)`,
          String.raw`\bi\s+(?:urgently\s+)?(?:need|want|require)\b${g(25)}(?:\bmoney\b|\bcash\b|₹\s*\d|\brs\.?\s*\d|\b\d{3,}\b)${g(30)}\b(?:send|transfer|gpay|paytm|phonepe|upi)\b`,
          String.raw`\b(?:send|transfer)\b${g(15)}\b(?:me|us)\b${g(25)}(?:\bmoney\b|\bamount\b|\bcash\b|₹\s*\d|\brs\.?\s*\d|\b\d{3,}\b)`,
        ],
        hi: [
          String.raw`(?:मुझे|मेरे\s*खाते\s*में|कृपया|जल्दी)${g(40)}(?:पैसे|रुपये|रुपए|राशि|₹\s*\d+|\d{3,}\s*(?:रुपये|रुपए))${g(30)}(?:भेज|ट्रांसफर|डाल)`,
          String.raw`(?:पैसे|रुपये|रुपए|राशि)${g(30)}(?:भेज|ट्रांसफर)\w*\s*(?:दो|दें|दीजिए|दीजिये|करो|कर\s*दो)`,
        ],
        ta: [
          String.raw`(?:எனக்கு|தயவுசெய்து|உடனே|அவசரமாக)${g(40)}(?:பணம|ரூபாய|₹\s*\d+|\d{3,})${g(30)}(?:அனுப்ப|மாற்ற|போட)`,
          String.raw`(?:பணம|ரூபாய)${g(30)}(?:அனுப்பு|மாற்று|போடு)(?:ங்கள|ங்க)`,
        ],
        hr: [
          String.raw`\b(?:please|plz|pls|kripya|jaldi|urgent|abhi|mujhe)\b${g(40)}(?:\b(?:paise|paisa|rupaye|rupay|amount)\b|₹\s*\d|\brs\.?\s*\d|\b\d{3,}\b)${g(30)}\b(?:bhej\w*|transfer|de\s*do|dal\s*do|send|gpay|paytm|phonepe)\b`,
          String.raw`\b(?:paise|paisa|rupaye|rupay)\b${g(30)}\b(?:bhej\w*|transfer\s+kar\w*|dal\s*do|de\s*do)\b`,
        ],
        tr: [
          String.raw`\b(?:please|plz|pls|udane|avasaram|urgent|enakku)\b${g(40)}(?:\b(?:panam|kaasu|rupai|amount)\b|₹\s*\d|\brs\.?\s*\d|\b\d{3,}\b)${g(30)}\b(?:anupp\w*|transfer|podu\w*|send|gpay|paytm|phonepe)\b`,
          String.raw`\b(?:panam|kaasu|rupai)\b${g(30)}\b(?:anupp\w*|podu\w*|transfer\s+pann\w*)\b`,
        ],
      },
    },
    {
      id: "msg_emergency_money",
      categories: ["urgent_transfer"],
      weight: 3,
      label: "Uses an emergency story to ask for money",
      why: "Scammers invent accidents and hospital bills so you act before you think. Call the person on a number you already know.",
      patterns: {
        en: [String.raw`\b(?:accident|hospital|emergency|stranded|surgery|admitted|in\s+trouble|arrested|stuck|medical)\b${g(60)}\b(?:send|transfer|need)\b${g(30)}(?:\bmoney\b|\bcash\b|\bamount\b|₹|\brs\b\.?|\b\d{3,}\b)`],
        hi: [String.raw`(?:एक्सीडेंट|दुर्घटना|अस्पताल|इमरजेंसी|आपातकाल|मुसीबत|संकट)${g(60)}(?:पैसे|रुपये|रुपए|राशि)${g(30)}(?:भेज|ट्रांसफर|चाहिए)`],
        ta: [String.raw`(?:விபத்து|மருத்துவமனை|அவசரம|ஆபத்து)${g(60)}(?:பணம|ரூபாய)${g(30)}(?:அனுப்ப|தேவை|மாற்ற)`],
        hr: [String.raw`\b(?:accident|hospital|emergency|musibat|mushkil)\b${g(60)}\b(?:paise|paisa|rupaye|money|amount)\b${g(30)}\b(?:bhej\w*|transfer|chahiye|send|dal\w*)\b`],
        tr: [String.raw`\b(?:accident|hospital|emergency|abathu|aapathu)\b${g(60)}\b(?:panam|kaasu|money|amount)\b${g(30)}\b(?:anupp\w*|venum|transfer|send|podu\w*)\b`],
      },
    },
    {
      id: "msg_payment_instruction",
      categories: ["payment_instruction"],
      weight: 3.5,
      label: "Tells you where to send money",
      why: "Be careful about paying to a UPI ID, account or QR code that arrived in a message. Confirm it with the real person or company first.",
      patterns: {
        en: [
          String.raw`\b(?:send|transfer|pay|deposit|remit)\b${g(40)}\b(?:to|into|on|at)\b${g(20)}\b(?:this|my|our|the\s+following|below|given|attached)\b${g(15)}\b(?:upi|account|a\/c|number|id|wallet|qr|link)\b`,
          String.raw`\b(?:send|transfer|pay|deposit|scan)\b${g(60)}${UPI_ID}`,
        ],
        hi: [
          String.raw`(?:इस|दिए\s*गए|नीचे\s*दिए)${g(20)}(?:यूपीआई|खाते|अकाउंट|नंबर|क्यूआर)${g(30)}(?:भेज|ट्रांसफर|जमा|भुगतान)`,
          String.raw`(?:भेज|ट्रांसफर|जमा|भुगतान|पे\s*करें)${g(60)}${UPI_ID}`,
          String.raw`${UPI_ID}${g(60)}(?:भेज|ट्रांसफर|जमा|भुगतान|पे\s*करें)`,
        ],
        ta: [
          String.raw`(?:அனுப்ப|செலுத்த|மாற்ற|பே\s*செய்ய)${g(60)}${UPI_ID}`,
          String.raw`${UPI_ID}${g(60)}(?:அனுப்ப|செலுத்த|மாற்ற|பே\s*செய்ய)`,
        ],
        hr: [String.raw`\b(?:bhej\w*|transfer|jama|pay|payment|bhugtan)\b${g(60)}${UPI_ID}`, String.raw`${UPI_ID}${g(60)}\b(?:bhej\w*|transfer|jama|pay|payment|bhugtan)\b`],
        tr: [String.raw`\b(?:anupp\w*|pay|transfer|podu\w*|kattu\w*)\b${g(60)}${UPI_ID}`, String.raw`${UPI_ID}${g(60)}\b(?:anupp\w*|pay|transfer|podu\w*|kattu\w*)\b`],
      },
    },
    {
      id: "msg_collect_request",
      categories: ["payment_instruction"],
      weight: 5,
      label: "Asks you to approve a payment request to get money",
      why: "Approving a payment request takes money out of your account. You never need to approve anything to receive money.",
      negate: { before: NEG_BEFORE_SECRET, after: NEG_AFTER_SECRET, weight: 0 },
      patterns: {
        en: [
          String.raw`\b(?:approve|accept|authori[sz]e|confirm)\b${g(30)}\b(?:collect|payment|money|upi|pay)\s+request\b`,
          String.raw`\bcollect\s+request\b${g(40)}\b(?:approve|accept|to\s+(?:get|receive))\b`,
        ],
        hi: [String.raw`(?:कलेक्ट|पेमेंट|पैसे|यूपीआई)\s*(?:रिक्वेस्ट|अनुरोध)${g(30)}(?:स्वीकार|अप्रूव|एक्सेप्ट|मंजूर)`],
        ta: [String.raw`(?:கலெக்ட|பேமெண்ட|பணம|யுபிஐ)\s*(?:ரிக்வெஸ்ட|கோரிக்கை)${g(30)}(?:ஏற்க|அப்ரூவ|ஒப்புக்கொள|உறுதி)`],
        hr: [String.raw`\b(?:collect|payment|paise|upi)\s*request\b${g(30)}\b(?:accept|approve|swikar|confirm)\w*`],
        tr: [String.raw`\b(?:collect|payment|panam|upi)\s*request\b${g(30)}\b(?:accept|approve|confirm)\w*`],
      },
    },
    {
      id: "msg_pay_to_receive",
      categories: ["payment_instruction"],
      weight: 5,
      label: "Asks you to scan a QR code or enter a PIN to receive money",
      why: "You never need to scan a code or enter a PIN to receive money. Doing so sends your money out.",
      negate: { before: NEG_BEFORE_SECRET, after: NEG_AFTER_SECRET, weight: 0 },
      patterns: {
        en: [
          String.raw`\bscan\b${g(30)}\bqr\b${g(60)}\b(?:receive|get|refund|cashback|credit|claim|reward|prize)\b`,
          String.raw`\b(?:enter|put|type|share)\b${g(15)}\b(?:your\s+)?(?:upi\s+)?pin\b${g(50)}\b(?:receive|get|refund|credit|claim)\b`,
          String.raw`\bto\s+(?:receive|get|claim)\b${g(30)}\b(?:money|refund|cashback|payment|prize)\b${g(40)}\b(?:enter|put|type|scan|share)\b${g(20)}\b(?:upi\s+)?(?:pin|qr)\b`,
        ],
        hi: [
          String.raw`(?:क्यूआर|क्यू\s*आर)${g(25)}स्कैन${g(50)}(?:पैसे\s*(?:पाने|मिलने|प्राप्त)|रिफंड|कैशबैक|इनाम)`,
          String.raw`पिन\s*(?:डालें|दर्ज|डाल|भरें)${g(50)}(?:पैसे\s*(?:पाने|प्राप्त|मिलने)|रिफंड)`,
        ],
        ta: [
          String.raw`(?:க்யூஆர|க்யூ\s*ஆர)${g(25)}ஸ்கேன்${g(50)}(?:பணம்\s*பெற|பணத்தைப்\s*பெற|ரீஃபண்ட|கேஷ்பேக|பரிசு)`,
          String.raw`பின்\s*(?:உள்ளிட|போட|பதிவிட)${g(50)}(?:பணம்\s*பெற|ரீஃபண்ட)`,
        ],
        hr: [
          String.raw`\bqr\b${g(25)}\bscan\b${g(50)}\b(?:paise\s+(?:pane|milne|prapt)|refund|cashback|inaam)\b`,
          String.raw`\bpin\b${g(25)}\b(?:dalen|daalo|dalna|enter|darj)\b${g(50)}\b(?:paise\s+(?:pane|milne)|refund)\b`,
        ],
        tr: [
          String.raw`\bqr\b${g(25)}\bscan\b${g(50)}\b(?:refund|cashback|parisu|panam\s+(?:vara|peru\w*|kidaikka))\b`,
          String.raw`\bpin\b${g(25)}\b(?:podu\w*|enter|type)\b${g(50)}\b(?:refund|panam\s+(?:vara|peru\w*))\b`,
        ],
      },
    },

    // ---- pressure tactics that are only weak signs on their own
    {
      id: "msg_urgency",
      categories: [],
      weight: 1.2,
      label: "Pushes you to act immediately",
      why: "Pressure to act right now is a common trick to stop you from thinking. Take a moment and check first.",
      patterns: {
        en: [String.raw`\b(?:immediately|urgent(?:ly)?|right\s+now|asap|within\s+(?:the\s+)?(?:next\s+)?\d+\s*(?:hours?|hrs?|minutes?|mins?|days?)|today\s+only|last\s+(?:chance|warning|date|day)|final\s+(?:notice|warning|reminder)|expires?\s+(?:today|soon|tonight)|act\s+now|hurry|without\s+delay|before\s+midnight)\b`],
        hi: [String.raw`(?:तुरंत|जल्द\s*से\s*जल्द|आज\s*ही|अंतिम\s*(?:चेतावनी|मौका|तारीख)|\d+\s*(?:घंटे|घण्टे|मिनट|दिन)\s*(?:के\s*अंदर|में|के\s*भीतर)|फौरन|तत्काल|अभी\s*(?:के\s*अभी|ही))`],
        ta: [String.raw`(?:உடனடியாக|உடனே|இன்றே|இன்றுக்குள|கடைசி\s*(?:வாய்ப்பு|எச்சரிக்கை|நாள)|\d+\s*(?:மணி\s*நேரத்திற்குள|மணி\s*நேரத்துக்குள|நிமிடத்தில|நாட்களுக்குள)|அவசரம|விரைவில)`],
        hr: [String.raw`\b(?:turant|abhi\s+(?:ke\s+abhi|hi)|jaldi|aaj\s+hi|fauran|tatkal|antim\s+(?:chetavni|mauka)|\d+\s*(?:ghante|ghanta|minute|din)\s*(?:ke\s+andar|me|mein))\b`],
        tr: [String.raw`\b(?:udane|udanadiya\w*|udanadiyaga|inniki|innaikku|kadaisi\s+(?:vaippu|naal)|avasaram|\d+\s*(?:mani\s*neratthukkul|mani\s+neratil|nimidam))\b`],
      },
    },
    {
      id: "msg_click_link",
      categories: [],
      weight: 1.5,
      label: "Asks you to tap a link or download an app",
      why: "Do not open links or install apps from unexpected messages. Go to the official website or app yourself.",
      patterns: {
        en: [String.raw`\b(?:click|tap|open|visit|follow)\b${g(20)}\b(?:link|here|below|url)\b`, String.raw`\bdownload\b${g(20)}\b(?:app|apk|application)\b`],
        hi: [String.raw`लिंक\s*(?:पर|को)?\s*(?:क्लिक|खोल|टैप)`, String.raw`क्लिक\s*करें`],
        ta: [String.raw`(?:இணைப்பை|லிங்கை|லிங்க)${g(15)}(?:கிளிக|தட்ட|திறக்க)`, String.raw`கிளிக்\s*செய்ய`],
        hr: [String.raw`\blink\s*(?:par|pe|ko)\s*(?:click|tap|kholen|kholo)`, String.raw`\bclick\s+kar\w*`],
        tr: [String.raw`\blink\s*(?:la|ai|il)?\s*click\s*pann\w*`, String.raw`\bclick\s+pann\w*`],
      },
    },

    // ---- reassurance: wording that genuine messages use. It can only lower the result a little.
    {
      id: "msg_official_channel",
      categories: [],
      weight: -1.5,
      label: "Points you to official channels or tells you never to share codes",
      why: "The message tells you to use a branch or the official app, or never to share codes. Genuine messages are usually worded like this. A scammer can copy this wording, so it lowers the result only a little.",
      patterns: {
        en: [
          String.raw`\b(?:do\s*not|don'?t|never|not)\s+(?:to\s+)?(?:share|disclose|reveal|give|tell)\b${g(30)}\b${OTP_L}\b`,
          String.raw`\b${OTP_L}\b${g(30)}\b(?:do\s*not|don'?t|never|should\s+not|must\s+not)\s+(?:be\s+)?(?:share\w*|disclose\w*|reveal\w*|given|tell)\b`,
          String.raw`\b(?:bank|we|sbi|hdfc|icici|axis|officials?|employees?|staff|company)\b${g(20)}\bnever\s+(?:ask|call|request)\w*`,
          String.raw`\bvisit\b${g(25)}\b(?:nearest|home|your)\s+(?:bank\s+)?branch\b`,
          String.raw`\b(?:official|authori[sz]ed)\s+(?:app|website|site|channel)\b`,
        ],
        hi: [
          String.raw`किसी\s*के\s*साथ\s*(?:साझा|शेयर)\s*न\s*कर`,
          String.raw`${OTP_HI}${g(30)}(?:साझा|शेयर)\s*न\s*कर`,
          String.raw`नजदीकी\s*शाखा`,
          String.raw`आधिकारिक\s*(?:ऐप|वेबसाइट|साइट)`,
        ],
        ta: [
          String.raw`யாருடனும்\s*பகிர\s*வேண்டாம்`,
          String.raw`${OTP_TA}${g(30)}பகிர\s*வேண்டாம்`,
          String.raw`அருகிலுள்ள\s*கிளை`,
          String.raw`அதிகாரப்பூர்வ\s*(?:செயலி|இணையதளம|வலைத்தளம)`,
        ],
        hr: [
          String.raw`\bkisi\s*(?:ke\s*saath|se)\s*(?:bhi\s*)?share\s*(?:na|mat|nahi)\s*kar\w*`,
          String.raw`\bnaz(?:di|dee)ki\s+branch\b`,
          String.raw`\bofficial\s+app\b`,
        ],
        tr: [
          String.raw`\byaridamum\s*share\s*pann\w*\s*(?:vendam|koodathu)`,
          String.raw`\bshare\s*pann\w*\s*(?:vendam|koodathu)\b`,
          String.raw`\barukil\w*\s*branch\b`,
        ],
      },
    },
  ]);

  // ---------------------------------------------------------------- extra signals used only when the text is a UPI payment reason
  // The UPI analyzer (Step 5) scans the reason a user typed for a payment with the same engine as the message checker,
  // plus these signals. The message checker itself does not use them, so Step 4 results are unchanged.
  const PAYMENT_SIGNALS = Object.freeze([
    {
      id: "msg_receive_money_fee",
      categories: ["payment_instruction"],
      weight: 5,
      label: "Asks you to pay first in order to receive money",
      why: "You never need to pay anything to receive money, a refund, a prize or a loan. Paying first is how this scam works.",
      negate: { before: NEG_BEFORE_SECRET, after: NEG_AFTER_SECRET, weight: 0 },
      patterns: {
        en: [
          String.raw`\b(?:pay|send|transfer|deposit)\b${g(40)}\bto\s+(?:receive|get|claim|release|unlock|collect)\b${g(30)}\b(?:money|refund|cashback|prize|reward|payment|loan|winnings?|amount|funds)\b`,
          String.raw`\b(?:receive|get|claim)\b${g(25)}\b(?:money|refund|cashback|prize|reward|loan|winnings?)\b${g(30)}\b(?:by|after|only\s+after|once\s+you)\s+(?:paying|sending|transferring|depositing)\b`,
          String.raw`\b(?:small|advance|initial|token)\s+(?:amount|payment|fee)\b${g(40)}\b(?:to\s+)?(?:receive|get|claim|release)\b`,
        ],
        hi: [
          String.raw`(?:पैसे|इनाम|ईनाम|रिफंड|कैशबैक|लोन|राशि)\s*(?:पाने|प्राप्त\s*करने|लेने)${g(40)}(?:भेज|भुगतान|जमा|ट्रांसफर|पे\s*करें)`,
          String.raw`(?:भेज|भुगतान|जमा|ट्रांसफर)${g(40)}(?:पैसे|इनाम|ईनाम|रिफंड|कैशबैक|लोन)\s*(?:पाने|प्राप्त|लेने)`,
        ],
        ta: [
          String.raw`(?:பணம்|பரிசு|ரீஃபண்ட்|கேஷ்பேக்|கடன்)\s*பெற${g(40)}(?:செலுத்த|அனுப்ப|கட்ட)`,
          String.raw`(?:செலுத்த|அனுப்ப|கட்ட)${g(40)}(?:பணம்|பரிசு|ரீஃபண்ட்|கேஷ்பேக்|கடன்)\s*பெற`,
        ],
        hr: [
          String.raw`\b(?:paise|inaam|refund|cashback|loan|reward|prize)\b${g(20)}\b(?:pane|paane|milne|prapt|lene)\b${g(40)}\b(?:pay|bhej\w*|jama|transfer|dena|bharna)\b`,
          String.raw`\b(?:pay|bhej\w*|jama|transfer|bharna)\b${g(40)}\b(?:paise|inaam|refund|cashback|loan|reward|prize)\b${g(20)}\b(?:pane|paane|milne|prapt|lene)\b`,
        ],
        tr: [
          String.raw`\b(?:panam|parisu|refund|cashback|loan)\b${g(20)}\b(?:vara|peru\w*|kidaikka|pera)\b${g(40)}\b(?:pay|anupp\w*|kattu\w*|transfer)\b`,
          String.raw`\b(?:pay|anupp\w*|kattu\w*|transfer)\b${g(40)}\b(?:panam|parisu|refund|cashback|loan)\b${g(20)}\b(?:vara|peru\w*|kidaikka|pera)\b`,
        ],
      },
    },
    {
      id: "msg_kyc_charge",
      categories: ["fake_kyc"],
      weight: 4,
      label: "Asks for a fee for KYC, verification or activation",
      why: "Banks and payment apps do not charge a fee to update KYC or to verify or activate an account. A request to pay one is a common trick.",
      negate: { before: NEG_BEFORE_SECRET, after: NEG_AFTER_SECRET, weight: 0 },
      patterns: {
        en: [
          String.raw`\b(?:pay|send|transfer|deposit|submit)\b${g(40)}\b(?:${KYC_L}|verification|activation|registration|account\s+upgrade|sim\s+activation)\s*(?:fees?|charges?|amount)\b`,
          String.raw`\b(?:${KYC_L}|verification|activation|registration)\s*(?:fees?|charges?|amount)\b${g(40)}(?:\b(?:pay\w*|send|transfer|deposit|due|pending|inr)\b|₹|\brs\b)`,
        ],
        hi: [
          String.raw`(?:${KYC_HI}|वेरिफिकेशन|एक्टिवेशन|रजिस्ट्रेशन)\s*(?:शुल्क|फीस|चार्ज)${g(40)}(?:भुगतान|जमा|भेज|दें|देना|चुकाएं)`,
          String.raw`(?:भुगतान|जमा|भेज)${g(40)}(?:${KYC_HI}|वेरिफिकेशन|एक्टिवेशन|रजिस्ट्रेशन)\s*(?:शुल्क|फीस|चार्ज)`,
        ],
        ta: [
          String.raw`(?:${KYC_TA}|சரிபார்ப்பு|செயல்படுத்தல்|பதிவு)\s*(?:கட்டண|சார்ஜ்)${g(40)}(?:செலுத்த|அனுப்ப|கட்ட)`,
          String.raw`(?:செலுத்த|அனுப்ப|கட்ட)${g(40)}(?:${KYC_TA}|சரிபார்ப்பு|செயல்படுத்தல்|பதிவு)\s*(?:கட்டண|சார்ஜ்)`,
        ],
        hr: [String.raw`\b(?:${KYC_L}|verification|activation|registration)\s*(?:fees?|charges?|shulk)\b${g(40)}\b(?:pay|bhej\w*|jama|dena|bharna|bhugtan|karein|karen)\b`],
        tr: [String.raw`\b(?:${KYC_L}|verification|activation|registration)\s*(?:fees?|charges?|kattanam)\b${g(40)}\b(?:pay|anupp\w*|kattu\w*|seluttu\w*)\b`],
      },
    },
    {
      id: "msg_parcel_release_fee",
      categories: ["parcel_fee"],
      weight: 4,
      label: "Asks for a fee to release or clear a parcel",
      why: "Fake courier and customs messages ask for a small \"release\" or \"clearance\" fee. Check any parcel in the courier's official app instead of paying.",
      patterns: {
        en: [
          String.raw`\b(?:parcel|package|courier|customs|consignment|shipment)\b${g(30)}\b(?:release|clearance|redelivery|re-delivery|handling|customs)\s*(?:fees?|charges?|duty)\b`,
          String.raw`\b(?:release|clearance|redelivery|handling)\s*(?:fees?|charges?)\b${g(30)}\b(?:parcel|package|courier|consignment|shipment)\b`,
        ],
        hi: [String.raw`(?:पार्सल|कूरियर|पैकेज|कस्टम)${g(30)}(?:रिलीज|क्लीयरेंस|हैंडलिंग)\s*(?:शुल्क|फीस|चार्ज)`],
        ta: [String.raw`(?:பார்சல|கூரியர|பொட்டல|சுங்க)${g(30)}(?:வெளியீட்டு|கிளியரன்ஸ்|கையாளும்)\s*(?:கட்டண|சார்ஜ்)`],
        hr: [String.raw`\b(?:parcel|courier|package)\b${g(30)}\b(?:release|clearance|handling)\s*(?:fees?|charges?|shulk)\b`],
        tr: [String.raw`\b(?:parcel|courier|package)\b${g(30)}\b(?:release|clearance|handling)\s*(?:fees?|charges?|kattanam)\b`],
      },
    },
    {
      id: "msg_refund_payment_request",
      categories: ["payment_instruction"],
      weight: 3,
      label: "Links a \"refund\" to something you must pay, scan or approve",
      why: "A real refund goes back to your account by itself. You do not pay, scan a code or approve a request to receive one.",
      negate: { before: NEG_BEFORE_SECRET, after: NEG_AFTER_SECRET, weight: 0 },
      patterns: {
        en: [String.raw`\brefund\w*\b${g(40)}\b(?:pay|send|approve|accept|scan|share|fees?|charges?|enter\s+(?:your\s+)?(?:upi\s+)?pin)\b`],
        hi: [String.raw`रिफंड${g(40)}(?:भेज|भुगतान|अप्रूव|स्वीकार|स्कैन|शुल्क|फीस|चार्ज)`],
        ta: [String.raw`ரீஃபண்ட்${g(40)}(?:செலுத்த|அனுப்ப|அப்ரூவ்|ஏற்க|ஸ்கேன்|கட்டண)`],
        hr: [String.raw`\brefund\b${g(40)}\b(?:pay|bhej\w*|approve|accept|scan|fees?|charges?|shulk)\b`],
        tr: [String.raw`\brefund\b${g(40)}\b(?:pay|anupp\w*|approve|accept|scan|fees?|charges?|kattanam)\b`],
      },
    },
    {
      id: "msg_wrong_transfer_request",
      categories: ["urgent_transfer"],
      weight: 3,
      label: "Says money was sent to you by mistake and asks you to send it back",
      why: "Scammers send a small amount, then ask you to return it to a different account. If money really arrived by mistake, ask your bank to reverse it. Do not send it yourself.",
      patterns: {
        en: [
          String.raw`\b(?:by\s+mistake|mistakenly|wrongly|wrong\s+(?:number|account|transfer|upi))\b${g(60)}\b(?:send|return|refund|transfer|give|pay)\b${g(15)}\b(?:back|it|money|amount)\b`,
          String.raw`\b(?:send|return|transfer|give|pay)\b${g(20)}\bback\b${g(60)}\b(?:by\s+mistake|mistakenly|wrongly|wrong\s+(?:number|account|transfer))\b`,
        ],
        hi: [String.raw`(?:गलती\s*से|गलत\s*(?:नंबर|खाते))${g(60)}(?:वापस|लौटा)`],
        ta: [String.raw`(?:தவறுதலாக|தவறான\s*(?:எண்|கணக்க))${g(60)}திருப்பி${g(15)}(?:அனுப்ப|கொடு)`],
        hr: [String.raw`\b(?:galti\s+se|galat\s+(?:number|account))\b${g(60)}\b(?:wapas|vapas|return)\b`],
        tr: [String.raw`\b(?:thavaraga|thappa|thavarudhala)\b${g(60)}\b(?:thirumbi|return|back)\b`],
      },
    },
    {
      id: "msg_customer_care_payment",
      categories: ["customer_care"],
      weight: 3.5,
      label: "A \"customer care\" or \"support\" contact asks you to pay or approve something",
      why: "Genuine customer care never asks you to send money, scan a code or approve a request. Fake support numbers are often placed in search results.",
      patterns: {
        en: [String.raw`\b${CARE_L}\b${g(50)}\b(?:pay|send|transfer|deposit|approve|scan)\b`],
        hi: [String.raw`${CARE_HI}${g(50)}(?:भुगतान|भेज|ट्रांसफर|जमा|अप्रूव)`],
        ta: [String.raw`${CARE_TA}${g(50)}(?:செலுத்த|அனுப்ப|மாற்ற|அப்ரூவ்)`],
        hr: [String.raw`\b${CARE_L}\b${g(50)}\b(?:pay|bhej\w*|transfer|jama|approve|scan)\b`],
        tr: [String.raw`\b${CARE_L}\b${g(50)}\b(?:pay|anupp\w*|transfer|approve|scan)\b`],
      },
    },
  ]);

  // In a UPI payment the payment itself is the request, so "send money" and "pay to this ID" would fire on every payment.
  const PAYMENT_CONTEXT_SKIP = Object.freeze(["msg_money_request", "msg_payment_instruction"]);

  // ---------------------------------------------------------------- extra signals used only for screenshot text (Step 6)
  // A screenshot of a chat or a payment receipt is read with the same scanner, plus these receipt-related signals.
  // A screenshot alone can never prove that money arrived, so the first signal is only a minor note and the second is the real warning.
  const RECEIPT_SIGNALS = Object.freeze([
    {
      id: "msg_payment_screenshot_claim",
      categories: [],
      weight: 1,
      label: "The screenshot says a payment was successful",
      why: "A screenshot can be edited or faked, and it cannot show that money reached a bank account. Check the payment in your own bank or UPI app.",
      patterns: {
        en: [
          String.raw`\b(?:payment|transaction|transfer)\s+(?:successful|successfully|completed|done|success)\b`,
          String.raw`\b(?:paid|sent|transferred)\s+successfully\b`,
          String.raw`\bmoney\s+(?:sent|transferred)\b`,
        ],
        hi: [String.raw`(?:भुगतान|पेमेंट|ट्रांजैक्शन|लेनदेन)\s*(?:सफल|पूरा|हो\s*गया)`],
        ta: [String.raw`(?:பணம்|பேமெண்ட்|பரிவர்த்தனை)\s*(?:வெற்றிகரமாக|செலுத்தப்பட்டது|முடிந்தது)`, String.raw`வெற்றிகரமாக\s*(?:செலுத்த|அனுப்ப)`],
        hr: [String.raw`\b(?:payment|paisa|paise|transaction)\s+(?:safal|successful|ho\s+gaya|kar\s+diya|bhej\s+diya)\b`],
        tr: [String.raw`\b(?:payment|panam)\s+(?:successful|pannitten|pannitean|anuppitten|aagividhu)\b`],
      },
    },
    {
      id: "msg_release_goods_request",
      categories: ["payment_instruction"],
      weight: 3.5,
      label: "Asks you to hand over goods or services because of a payment screenshot",
      why: "Scammers send a faked payment screenshot and ask you to send the goods straight away. Release nothing until the money shows in your own bank or UPI app.",
      negate: { before: NEG_BEFORE_SECRET, after: NEG_AFTER_SECRET, weight: 0 },
      patterns: {
        en: [
          String.raw`\b(?:payment|paid|transferred|sent)\b${g(60)}\b(?:screenshot|receipt|proof)\b${g(60)}\b(?:send|dispatch|deliver|release|ship|hand\s+over|give)\b`,
          String.raw`\b(?:send|dispatch|deliver|release|ship|hand\s+over)\b${g(40)}\b(?:goods|item|items|product|order|parcel|vehicle|car|bike|phone|material)\b${g(60)}\b(?:i\s+have\s+paid|payment\s+(?:done|sent|made|successful)|already\s+paid|paid)\b`,
          String.raw`\bpayment\s+(?:done|made|sent|successful)\b${g(50)}\b(?:please\s+)?(?:send|dispatch|deliver|release|ship)\b`,
          String.raw`\b(?:screenshot|receipt|proof)\b${g(40)}\b(?:attached|sent|above|below)\b${g(60)}\b(?:send|dispatch|deliver|release|ship)\b`,
          // Chats often put "payment done", "screenshot attached" and "please send" in separate sentences, so these two may cross
          // a full stop. They need "please", and stay within 80 characters.
          String.raw`\bpayment\s+(?:done|made|sent|successful)\b[\s\S]{0,80}?\b(?:please|pls|kindly)\s+(?:send|dispatch|deliver|release|ship)\b`,
          String.raw`\b(?:i\s+have\s+(?:already\s+)?paid|already\s+paid)\b[\s\S]{0,60}?\b(?:please|pls|kindly)\s+(?:send|dispatch|deliver|release|ship)\b`,
          String.raw`\b(?:please|pls|kindly)\s+(?:send|dispatch|deliver|release|ship)\b[\s\S]{0,60}?\b(?:i\s+have\s+(?:already\s+)?paid|already\s+paid)\b`,
        ],
        hi: [
          String.raw`(?:भुगतान|पेमेंट|पैसे)\s*(?:कर\s*दिया|हो\s*गया|भेज\s*दिया)${g(60)}(?:सामान|माल|प्रोडक्ट|ऑर्डर|पार्सल)${g(40)}(?:भेज|दे\s*दो|डिस्पैच|रिलीज)`,
          String.raw`स्क्रीनशॉट${g(60)}(?:सामान|माल|ऑर्डर)${g(40)}(?:भेज|रिलीज|दे\s*दो)`,
        ],
        ta: [
          String.raw`(?:பணம்|பேமெண்ட்)\s*(?:செலுத்திவிட்டேன்|அனுப்பிவிட்டேன்|செலுத்தப்பட்டது)${g(60)}(?:பொருள|ஆர்டர|பார்சல)${g(40)}(?:அனுப்ப|கொடு)`,
          String.raw`ஸ்கிரீன்ஷாட்${g(60)}(?:பொருள|ஆர்டர|பார்சல)${g(40)}(?:அனுப்ப|கொடு)`,
        ],
        hr: [String.raw`\b(?:payment|paisa|paise)\s+(?:kar\s+diya|ho\s+gaya|bhej\s+diya|done)\b${g(60)}\b(?:saman|maal|order|parcel|product)\b${g(40)}\b(?:bhej\w*|de\s*do|dispatch|release)\b`],
        tr: [String.raw`\b(?:payment|panam)\s+(?:pannitten|pannitean|anuppitten|done)\b${g(60)}\b(?:order|parcel|product|porul)\b${g(40)}\b(?:anupp\w*|kodu\w*|dispatch)\b`],
      },
    },
  ]);

  // ---------------------------------------------------------------- scam categories shown to the user
  const CATEGORIES = Object.freeze([
    Object.freeze({ id: "fake_kyc", label: "Fake KYC update" }),
    Object.freeze({ id: "digital_arrest", label: "Digital arrest or fake officer threat" }),
    Object.freeze({ id: "parcel_fee", label: "Fake parcel or delivery fee" }),
    Object.freeze({ id: "otp_pin", label: "OTP, PIN or password request" }),
    Object.freeze({ id: "account_suspension", label: "Fake account suspension warning" }),
    Object.freeze({ id: "prize", label: "Lottery, prize or advance-fee scam" }),
    Object.freeze({ id: "customer_care", label: "Fake customer care" }),
    Object.freeze({ id: "urgent_transfer", label: "Urgent money transfer request" }),
    Object.freeze({ id: "impersonation", label: "Bank or official impersonation" }),
    Object.freeze({ id: "payment_instruction", label: "Suspicious payment instructions" }),
  ]);

  // ---------------------------------------------------------------- language detection (a best guess, never a certainty)
  const LANGUAGE_LABELS = Object.freeze({
    en: "English",
    hi: "Hindi (Devanagari script)",
    ta: "Tamil",
    hinglish: "Hinglish (Hindi in English letters)",
    ta_roman: "Tamil in English letters",
    unknown: "Not enough text to tell",
  });

  // Words that are clearly Hindi written in English letters, and clearly Tamil written in English letters.
  // Words that are also ordinary English ("to", "me", "par", "hi") are left out on purpose.
  const HINGLISH_WORDS = Object.freeze(new Set([
    "aap", "aapka", "aapki", "aapke", "apna", "apni", "apne", "hai", "hain", "nahi", "nahin", "karo", "kare", "karein", "karen",
    "kariye", "kijiye", "kripya", "turant", "jaldi", "abhi", "bhejo", "bheje", "batao", "bata", "khata", "paise", "paisa",
    "rupaye", "band", "jayega", "jayegi", "warna", "varna", "agar", "mein", "liye", "kya", "aur", "hoga", "hogi", "kyunki",
    "lekin", "sabhi", "tum", "tumhara", "mera", "hum", "humara", "dhanyavaad", "dhanyawad", "bhai", "dijiye", "milega", "milegi",
    "sirf", "yeh", "yah", "woh", "kuch", "koi", "kisi", "gaya", "gayi", "chuka",
  ]));
  const TAMIL_ROMAN_WORDS = Object.freeze(new Set([
    "unga", "ungal", "ungalukku", "ungaludaya", "ungalin", "ungala", "ungaluku", "inga", "intha", "antha", "udane", "seyyavum",
    "seiyavum", "seyyungal", "panunga", "pannunga", "pannanum", "pannidunga", "pannu", "vendam", "vendum", "irukku", "illa", "illai",
    "kanakku", "panam", "kaasu", "anuppunga", "sollunga", "kudunga", "kodunga", "mudiyum", "mudiyadhu", "aagum", "aagividum",
    "nirutha", "vangi", "ungalukkum", "ennai", "enakku", "naan", "neenga", "romba", "seri", "sari",
  ]));
  const ENGLISH_WORDS = Object.freeze(new Set([
    "the", "is", "are", "your", "you", "will", "be", "to", "of", "and", "has", "have", "please", "dear", "account", "click", "link",
    "bank", "if", "or", "not", "this", "that", "with", "for", "from", "on", "in", "it", "do", "we", "our", "by", "at", "an", "a",
    "as", "can", "now", "today", "customer", "update", "pay", "message", "number", "call", "verify", "has", "been",
  ]));

  // Letters that look like Latin letters but come from other alphabets. Scammers use them to dodge keyword filters.
  const CONFUSABLES = Object.freeze({
    "\u0430": "a", "\u0435": "e", "\u043e": "o", "\u0440": "p", "\u0441": "c", "\u0445": "x", "\u0443": "y", "\u0456": "i",
    "\u0455": "s", "\u043a": "k", "\u0442": "t", "\u04bb": "h", "\u03bf": "o", "\u03c1": "p", "\u03b9": "i", "\u0391": "a", "\u0392": "b",
  });

  // Endings that make a bare address like "bit.ly/abc" count as a link. Ordinary file names ("report.pdf") do not.
  const LINK_ENDINGS = Object.freeze([
    "com", "in", "net", "org", "co", "xyz", "top", "info", "link", "click", "online", "site", "live", "cc", "tk", "ml", "ga", "cf",
    "gq", "icu", "vip", "shop", "club", "app", "me", "ly", "gl", "to", "page", "store", "work", "support", "help", "bank", "cfd",
    "sbs", "buzz", "rest", "digital", "pw", "ws", "gy", "gd", "id", "sbi", "ai",
  ]);

  const LIMITS = Object.freeze({
    maxChars: 5000, // only this many characters of a message are analysed
    maxMatchesPerPattern: 6,
    maxHighlights: 30,
    maxLinks: 3, // addresses inside a message that are also checked by the URL checker
    shortTextLetters: 12, // below this many letters the result carries a "very short message" note
    minCategoryPoints: 3, // a scam category is named only when its signs add up to at least this
    minSecondaryPoints: 2,
    negateWindowBefore: 45,
    negateWindowAfter: 60,
  });

  return Object.freeze({ SIGNALS, PAYMENT_SIGNALS, PAYMENT_CONTEXT_SKIP, RECEIPT_SIGNALS, CATEGORIES, LANGUAGE_LABELS, HINGLISH_WORDS, TAMIL_ROMAN_WORDS, ENGLISH_WORDS, CONFUSABLES, LINK_ENDINGS, LIMITS });
});

/*
 * Prevenza: URL intelligence RULES (data only). Everything here is configurable and runs offline.
 *
 * To tune detection, edit the numbers, lists and brand entries below. url-intel.js contains the logic.
 * The lists are small and hand-written. They are a starting point, not a complete database.
 * Only plain domain names are stored here, never full web addresses.
 */
(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.urlRules = api;
  }
})(typeof self !== "undefined" ? self : this, function () {
  const LIMITS = Object.freeze({
    maxInputLength: 2048, // longest address we will look at
    maxHostnameLength: 253,
    maxLabelLength: 63,
    maxIndicatorsShown: 6,
  });

  // Score -> level. Below `medium` is LOW. `high` also applies whenever a critical indicator is found.
  const THRESHOLDS = Object.freeze({ medium: 3, high: 6 });

  // How much each indicator adds to the score. Negative numbers lower it.
  const WEIGHTS = Object.freeze({
    homograph_mixed: 7, // letters from different alphabets in one word (critical)
    homograph_whole: 6, // look-alike letters that spell a famous name (critical)
    at_sign_domain: 6, // https://bank.com@evil.com (critical)
    brand_lookalike: 6, // digits or letters swapped to copy a famous name (paypa1, rnicrosoft)
    brand_in_subdomain: 5, // famous name placed in front of an unrelated site
    brand_typosquat: 5, // a one-letter misspelling of a famous name
    misleading_subdomain: 5, // a trusted-looking address placed in front of another site
    ip_public: 5, // a number address instead of a name
    brand_in_domain: 3.5, // famous name inside an address that is not theirs
    shortener: 3, // link shortener hides the destination
    credentials: 2.5, // username in the address
    brand_with_keyword: 2, // famous name plus words like login, verify, kyc
    many_subdomains: 2,
    redirect_param: 2,
    at_in_path: 1.5,
    backslash: 3, // https://evil.com\@good.com: browsers read the backslash as a slash
    ip_ipv6: 3,
    ip_disguised: 1.5,
    suspicious_tld: 1.5,
    long_hostname: 1.5,
    many_hyphens: 1.5,
    free_hosting: 1,
    keywords: 1,
    idn: 1,
    unusual_port: 1,
    encoded_chars: 1,
    path_keywords: 1,
    no_https: 0.5,
    local_address: 0,
    known_official: -3,
    restricted_suffix: -2,
  });

  // Link shorteners. They are not always bad, but they hide where a link really goes.
  const SHORTENERS = Object.freeze([
    "bit.ly", "tinyurl.com", "t.co", "ow.ly", "is.gd", "v.gd", "cutt.ly", "rb.gy", "shorturl.at", "bl.ink",
    "t.ly", "rebrand.ly", "tiny.cc", "s.id", "buff.ly", "lnkd.in", "goo.gl", "adf.ly", "bit.do", "shorte.st",
  ]);

  // Endings that scammers use a lot. Plenty of honest sites use them too, so the weight is small.
  const SUSPICIOUS_TLDS = Object.freeze([
    "xyz", "top", "click", "icu", "vip", "buzz", "cfd", "sbs", "cyou", "monster", "tk", "ml", "ga", "cf", "gq",
    "rest", "zip", "mov", "loan", "work", "bid", "win", "quest", "autos", "boats", "mom",
  ]);

  // Places where anyone can make a free site. Treated like a public ending so "x.vercel.app" belongs to x.
  const FREE_HOSTS = Object.freeze([
    "github.io", "gitlab.io", "blogspot.com", "wordpress.com", "wixsite.com", "weebly.com", "vercel.app",
    "netlify.app", "pages.dev", "workers.dev", "herokuapp.com", "web.app", "firebaseapp.com", "azurewebsites.net",
    "onrender.com", "glitch.me", "repl.co", "000webhostapp.com", "ngrok-free.app", "trycloudflare.com", "duckdns.org",
  ]);

  // Two-part endings (a small list, not the full Public Suffix List).
  const MULTI_SUFFIXES = Object.freeze([
    "co.in", "org.in", "net.in", "gov.in", "nic.in", "ac.in", "edu.in", "res.in", "bank.in", "firm.in", "gen.in", "ind.in",
    "co.uk", "org.uk", "gov.uk", "ac.uk", "com.au", "net.au", "org.au", "co.nz", "co.za", "com.br", "com.cn", "co.jp",
    "com.sg", "com.my", "com.pk", "com.bd", "com.lk", "co.id", "com.ng", "com.tr", "com.mx", "com.ar", "co.ke",
  ]);

  // Endings that only the right kind of organisation can register. A fake bank cannot get one of these.
  const RESTRICTED_SUFFIXES = Object.freeze(["gov.in", "nic.in", "bank.in", "ac.in", "edu.in", "sbi", "gov", "edu", "mil", "gov.uk", "ac.uk"]);

  // Words scammers like to put in addresses. One alone proves nothing.
  const KEYWORDS = Object.freeze([
    "login", "signin", "secure", "security", "verify", "verification", "update", "kyc", "account", "bank", "banking",
    "wallet", "payment", "upi", "refund", "reward", "rewards", "claim", "otp", "support", "helpdesk", "confirm",
    "alert", "unlock", "suspend", "suspended", "bonus", "prize", "lottery", "customer",
  ]);

  // Words that look like the end of a web address. Seen at the front of an address they are a trick.
  const TLD_LIKE_LABELS = Object.freeze(["com", "net", "org", "in", "co", "gov", "edu", "bank", "info", "biz", "io"]);

  // Words in the path or query of a user-supplied link that raise the score only when something else already does.
  const PATH_KEYWORDS = Object.freeze(["login", "signin", "verify", "update", "kyc", "otp", "secure", "account", "payment", "refund", "claim"]);

  // Names of query parameters that carry another address (a common way to bounce you to a bad site).
  const REDIRECT_PARAMS = Object.freeze(["url", "redirect", "redirect_uri", "redirect_url", "next", "return", "return_url", "goto", "dest", "destination", "continue", "link"]);

  // Letters that look like Latin letters. Used to spot look-alike words.
  const CONFUSABLES = Object.freeze({
    "\u0430": "a", "\u0435": "e", "\u043E": "o", "\u0440": "p", "\u0441": "c", "\u0443": "y", "\u0445": "x", "\u0456": "i",
    "\u0458": "j", "\u04CF": "l", "\u0455": "s", "\u04BB": "h", "\u0501": "d", "\u051B": "q", "\u051D": "w", "\u0261": "g",
    "\u03BF": "o", "\u03BD": "v", "\u03B1": "a", "\u03C1": "p", "\u03B9": "i", "\u03BA": "k", "\u03C5": "u",
    "\u0131": "i", "\u0142": "l",
  });

  /*
   * Famous names that scammers copy. Each entry:
   *   id, name       how we refer to it
   *   exact          words that must match a whole part of the address (short or common words)
   *   contains       longer names that can sit inside a longer word
   *   domains        the real websites (a host matches if it equals one of these or ends with ".<one>")
   *   typo           true = also catch one-letter misspellings (off for words that are common in English)
   * Keep this list to names you are sure about. A missing real domain here causes a false warning.
   */
  const BRANDS = Object.freeze([
    { id: "sbi", name: "SBI", exact: ["sbi"], contains: ["onlinesbi", "yonosbi"], domains: ["sbi.co.in", "onlinesbi.sbi", "onlinesbi.com", "sbicard.com", "sbilife.co.in", "sbimf.com", "bank.sbi", "yonosbi.com"] },
    { id: "hdfc", name: "HDFC Bank", exact: ["hdfc"], contains: ["hdfcbank"], domains: ["hdfcbank.com", "hdfc.com", "hdfclife.com", "hdfcergo.com", "hdfcsec.com", "hdfcfund.com"] },
    { id: "icici", name: "ICICI Bank", exact: ["icici"], contains: ["icicibank"], domains: ["icicibank.com", "icici.com", "icicidirect.com", "iciciprulife.com", "icicilombard.com", "icicipruamc.com", "icicisecurities.com"] },
    { id: "axis", name: "Axis Bank", exact: [], contains: ["axisbank"], domains: ["axisbank.com", "axismf.com"] },
    { id: "kotak", name: "Kotak", exact: ["kotak"], contains: [], typo: false, domains: ["kotak.com", "kotakbank.com", "kotaksecurities.com", "kotakmf.com"] },
    { id: "pnb", name: "Punjab National Bank", exact: ["pnb"], contains: ["pnbindia"], domains: ["pnbindia.in", "netpnb.com", "pnbindia.com"] },
    { id: "bob", name: "Bank of Baroda", exact: [], contains: ["bankofbaroda"], domains: ["bankofbaroda.in", "bankofbaroda.com", "bobfinancial.com"] },
    { id: "paytm", name: "Paytm", exact: ["paytm"], contains: ["paytmbank"], typo: true, glue: true, domains: ["paytm.com", "paytmbank.com", "paytmmoney.com", "paytm.me"] },
    { id: "phonepe", name: "PhonePe", exact: [], contains: ["phonepe"], soundsLike: ["phonepay", "fonepe", "fonepay"], domains: ["phonepe.com"] },
    { id: "npci", name: "NPCI / BHIM UPI", exact: ["npci", "bhim"], contains: [], domains: ["npci.org.in", "bhimupi.org.in"] },
    { id: "irctc", name: "IRCTC", exact: ["irctc"], contains: [], typo: true, glue: true, domains: ["irctc.co.in", "irctc.com", "irctctourism.com"] },
    { id: "uidai", name: "Aadhaar (UIDAI)", exact: ["uidai"], contains: [], typo: true, glue: true, domains: ["uidai.gov.in"] },
    { id: "incometax", name: "Income Tax Department", exact: [], contains: ["incometax"], domains: ["incometax.gov.in", "incometaxindia.gov.in"] },
    { id: "epfo", name: "EPFO", exact: ["epfo"], contains: ["epfindia"], domains: ["epfindia.gov.in"] },
    { id: "rbi", name: "Reserve Bank of India", exact: ["rbi"], contains: [], domains: ["rbi.org.in"] },
    { id: "amazon", name: "Amazon", exact: [], contains: ["amazon"], domains: ["amazon.in", "amazon.com", "amazon.co.uk", "amazon.de", "amazon.ca", "amazon.com.au", "amazon.fr", "amazon.it", "amazon.es", "amazon.co.jp", "amazon.ae", "amazon.sg", "amazonaws.com", "amazonpay.in", "amazon.jobs", "amzn.to", "amzn.in", "primevideo.com", "amazon-adsystem.com"] },
    { id: "flipkart", name: "Flipkart", exact: [], contains: ["flipkart"], domains: ["flipkart.com"] },
    { id: "airtel", name: "Airtel", exact: [], contains: ["airtel"], domains: ["airtel.in", "airtel.com", "airtelbank.com"] },
    { id: "whatsapp", name: "WhatsApp", exact: [], contains: ["whatsapp"], domains: ["whatsapp.com", "whatsapp.net", "wa.me"] },
    { id: "google", name: "Google", exact: [], contains: ["google"], domains: ["google.com", "google.co.in", "gstatic.com", "googleapis.com", "youtube.com", "youtu.be", "gmail.com", "googleusercontent.com", "withgoogle.com", "g.co", "googlevideo.com", "ggpht.com", "googleadservices.com", "googlesyndication.com", "googletagmanager.com"] },
    { id: "microsoft", name: "Microsoft", exact: [], contains: ["microsoft"], domains: ["microsoft.com", "microsoftonline.com", "live.com", "office.com", "office365.com", "outlook.com", "windows.com", "azure.com", "bing.com", "msn.com", "skype.com", "xbox.com", "linkedin.com", "sharepoint.com", "onedrive.com"] },
    { id: "apple", name: "Apple", exact: ["apple"], contains: [], typo: false, domains: ["apple.com", "icloud.com", "me.com", "mzstatic.com"] },
    { id: "paypal", name: "PayPal", exact: [], contains: ["paypal"], domains: ["paypal.com", "paypal.me", "paypalobjects.com"] },
    { id: "netflix", name: "Netflix", exact: [], contains: ["netflix"], domains: ["netflix.com", "nflximg.net", "nflxso.net", "nflxvideo.net"] },
    { id: "facebook", name: "Facebook / Meta", exact: [], contains: ["facebook"], domains: ["facebook.com", "fb.com", "fbcdn.net", "facebook.net", "facebookmail.com", "meta.com", "messenger.com"] },
    { id: "instagram", name: "Instagram", exact: [], contains: ["instagram"], domains: ["instagram.com", "cdninstagram.com"] },
    { id: "telegram", name: "Telegram", exact: [], contains: ["telegram"], domains: ["telegram.org", "t.me", "telegram.me"] },
  ]);

  return Object.freeze({
    LIMITS, THRESHOLDS, WEIGHTS, SHORTENERS, SUSPICIOUS_TLDS, FREE_HOSTS, MULTI_SUFFIXES, RESTRICTED_SUFFIXES,
    KEYWORDS, TLD_LIKE_LABELS, PATH_KEYWORDS, REDIRECT_PARAMS, CONFUSABLES, BRANDS,
  });
});

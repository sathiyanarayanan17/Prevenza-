/*
 * Prevenza: offline URL intelligence. Pure functions, no browser APIs except the standard URL class, no network.
 *
 * Two ways in, with different privacy limits:
 *   analyzeSite({ hostname, protocol })  the permitted signal from a web page: site name and protocol ONLY.
 *   analyzeUrl("https://...")            a full address the USER typed or pasted into the link checker.
 *
 * Neither function stores anything. Results contain the host name and plain-language reasons, never the full address.
 * The result is a PRELIMINARY risk (low, medium, high). A low result is not proof of safety.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const rules = isNode ? require("./url-rules.js") : root.Prevenza.urlRules;
  const api = factory(rules);
  if (isNode) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    root.Prevenza.urlIntel = api;
  }
})(typeof self !== "undefined" ? self : this, function (R) {
  "use strict";

  const W = R.WEIGHTS;
  const SCHEME_PREFIX = "https:" + "//"; // used only to give a bare "example.com" a scheme so it can be parsed

  const URL_RISK = Object.freeze({
    low: Object.freeze({ id: "low", label: "Low risk", pill: "low" }),
    medium: Object.freeze({ id: "medium", label: "Medium risk", pill: "caution" }),
    high: Object.freeze({ id: "high", label: "High risk", pill: "danger" }),
  });

  const SUMMARY = Object.freeze({
    low: "No strong warning signs in the address itself. That does not prove the site is safe: scammers also use HTTPS and ordinary-looking names, so stay careful with passwords and payments.",
    medium: "Some things about this address look unusual. Check carefully before you type a password, an OTP or any payment details.",
    high: "This address has strong warning signs of a scam. Do not enter passwords, OTPs or payment details. If someone sent you this link, contact them another way to check.",
  });

  const ERRORS = Object.freeze({
    empty: "Please type or paste a web address.",
    "not-text": "That is not a web address.",
    "too-long": "That address is too long to check.",
    "invalid-characters": "That does not look like a single web address. Remove spaces and try again.",
    invalid: "That does not look like a valid web address.",
    "unsupported-scheme": "Only web addresses that start with http or https can be checked.",
  });

  function fail(error) {
    return { ok: false, error, message: ERRORS[error] || ERRORS.invalid };
  }

  // ---------------------------------------------------------------- text helpers

  /** Punycode decoder (RFC 3492). Returns null if the text is not valid punycode. */
  function punycodeDecode(input) {
    const base = 36, tMin = 1, tMax = 26, skew = 38, damp = 700;
    let n = 128, i = 0, bias = 72;
    const output = [];
    let basic = input.lastIndexOf("-");
    if (basic < 0) basic = 0;
    for (let j = 0; j < basic; j++) {
      if (input.charCodeAt(j) >= 0x80) return null;
      output.push(input.charCodeAt(j));
    }
    const adapt = (delta, numPoints, first) => {
      let k = 0;
      delta = first ? Math.floor(delta / damp) : delta >> 1;
      delta += Math.floor(delta / numPoints);
      while (delta > (((base - tMin) * tMax) >> 1)) {
        delta = Math.floor(delta / (base - tMin));
        k += base;
      }
      return Math.floor(k + ((base - tMin + 1) * delta) / (delta + skew));
    };
    for (let index = basic > 0 ? basic + 1 : 0; index < input.length; ) {
      const oldi = i;
      for (let w = 1, k = base; ; k += base) {
        if (index >= input.length) return null;
        const cp = input.charCodeAt(index++);
        // a-z = 0..25, 0-9 = 26..35, anything else is not valid punycode
        const digit = cp >= 48 && cp <= 57 ? cp - 22 : cp >= 65 && cp <= 90 ? cp - 65 : cp >= 97 && cp <= 122 ? cp - 97 : base;
        if (digit >= base) return null;
        i += digit * w;
        const t = k <= bias ? tMin : k >= bias + tMax ? tMax : k - bias;
        if (digit < t) break;
        w *= base - t;
        if (w > 0x7fffffff || i > 0x7fffffff) return null;
      }
      const out = output.length + 1;
      bias = adapt(i - oldi, out, oldi === 0);
      n += Math.floor(i / out);
      i %= out;
      if (n > 0x10ffff) return null;
      output.splice(i++, 0, n);
    }
    try {
      return String.fromCodePoint(...output);
    } catch (e) {
      return null;
    }
  }

  /** Which alphabet a character belongs to. Digits and hyphens are "Common". */
  function scriptOf(ch) {
    const c = ch.codePointAt(0);
    if (c < 0x80) return /[a-z]/i.test(ch) ? "Latin" : "Common";
    if ((c >= 0xc0 && c <= 0x24f) || (c >= 0x1e00 && c <= 0x1eff) || c === 0x261 || c === 0x131 || c === 0x142) return "Latin";
    if (c >= 0x400 && c <= 0x52f) return "Cyrillic";
    if (c >= 0x370 && c <= 0x3ff) return "Greek";
    if (c >= 0x900 && c <= 0x97f) return "Devanagari";
    if (c >= 0xb80 && c <= 0xbff) return "Tamil";
    if (c >= 0x600 && c <= 0x6ff) return "Arabic";
    if (c >= 0x4e00 && c <= 0x9fff) return "Han";
    if (c >= 0x3040 && c <= 0x30ff) return "Kana";
    if (c >= 0xac00 && c <= 0xd7af) return "Hangul";
    return "Other";
  }

  /** "paypa1" -> "paypal", Cyrillic "аpple" -> "apple". Used only to compare against famous names. */
  function skeleton(text) {
    const folded = text.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
    let out = "";
    for (const ch of folded) out += R.CONFUSABLES[ch] || ch;
    if (/[a-z]/.test(out)) out = out.replace(/0/g, "o").replace(/1/g, "l").replace(/5/g, "s");
    return out.replace(/rn/g, "m").replace(/vv/g, "w");
  }

  /** Edit distance where a swapped pair of letters counts as one change. Returns 3 when clearly far apart. */
  function editDistance(a, b) {
    if (a === b) return 0;
    const al = a.length, bl = b.length;
    if (Math.abs(al - bl) > 2) return 3;
    const d = [];
    for (let i = 0; i <= al; i++) d[i] = [i];
    for (let j = 1; j <= bl; j++) d[0][j] = j;
    for (let i = 1; i <= al; i++) {
      for (let j = 1; j <= bl; j++) {
        const cost = a[i - 1] === b[j - 1] ? 0 : 1;
        d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + cost);
        if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) d[i][j] = Math.min(d[i][j], d[i - 2][j - 2] + 1);
      }
    }
    return d[al][bl];
  }

  // ---------------------------------------------------------------- parsing

  const NON_WEB_SCHEME = /^(javascript|data|mailto|tel|sms|file|ftp|blob|about|chrome|chrome-extension|view-source|upi|intent|whatsapp|market|ws|wss):/i;
  const VALID_LABEL = /^[a-z0-9_](?:[a-z0-9_-]*[a-z0-9_])?$/;

  /** Safely turn text into a parsed address. Never throws. */
  function parseUrl(input) {
    if (typeof input !== "string") return fail("not-text");
    const text = input.trim();
    if (!text) return fail("empty");
    if (text.length > R.LIMITS.maxInputLength) return fail("too-long");
    if (/[\u0000-\u0020\u007f-\u009f\u2028\u2029]/.test(text)) return fail("invalid-characters");
    if (NON_WEB_SCHEME.test(text)) return fail("unsupported-scheme");

    const hasScheme = /^[a-z][a-z0-9+.-]*:\/\//i.test(text);
    const candidate = hasScheme ? text : SCHEME_PREFIX + text;
    let url;
    try {
      url = new URL(candidate);
    } catch (e) {
      return fail("invalid");
    }
    if (url.protocol !== "http:" && url.protocol !== "https:") return fail("unsupported-scheme");
    return buildParsed(url, candidate, !hasScheme);
  }

  function buildParsed(url, candidate, assumedScheme) {
    const host = url.hostname.replace(/\.$/, "").toLowerCase();
    if (!host || host.length > R.LIMITS.maxHostnameLength) return fail("invalid");
    if (host.split(".").some((l) => l.length > R.LIMITS.maxLabelLength)) return fail("invalid");
    // Step 11 fix: the browser's address parser accepts names such as "ht!tp" or "-bad-" that no real website can have.
    // Each part of a name must be letters, digits, hyphens or underscores, and must not start or end with a hyphen.
    // (International names arrive here already converted to "xn--" form, so they pass. IPv6 addresses are in brackets.)
    if (!host.startsWith("[") && !host.split(".").every((l) => VALID_LABEL.test(l))) return fail("invalid");

    // The text the person actually typed between "//" and the next "/", used to spot disguised number addresses.
    const m = /^[a-z][a-z0-9+.-]*:\/\/([^/?#\\]*)/i.exec(candidate);
    const authority = m ? m[1] : "";
    const at = authority.lastIndexOf("@");
    let rawHost = (at >= 0 ? authority.slice(at + 1) : authority).toLowerCase();
    if (!rawHost.startsWith("[")) rawHost = rawHost.replace(/:\d*$/, "");

    return {
      ok: true,
      url,
      host,
      scheme: url.protocol,
      username: url.username,
      password: url.password,
      port: url.port,
      path: url.pathname,
      search: url.search,
      rawHost,
      assumedScheme,
      hasBackslash: /^[a-z][a-z0-9+.-]*:\/\/[^/?#]*\\/i.test(candidate),
      hasAtAfterAuthority: candidate.indexOf("@", m ? m[0].length : 0) >= 0,
    };
  }

  // ---------------------------------------------------------------- host structure

  const MULTI = new Set([...R.MULTI_SUFFIXES, ...R.FREE_HOSTS]);
  const FREE = new Set(R.FREE_HOSTS);

  /** Split a host name into sub-domain labels, the main name, and the ending. Small built-in list, not the full public suffix list. */
  function splitHost(host) {
    const labels = host.split(".");
    let suffixLen = 1;
    if (labels.length >= 3 && MULTI.has(labels.slice(-2).join("."))) suffixLen = 2;
    else if (labels.length === 2 && MULTI.has(host)) suffixLen = 2;
    const suffix = labels.slice(-suffixLen).join(".");
    const sldIndex = labels.length - suffixLen - 1;
    const sld = sldIndex >= 0 ? labels[sldIndex] : "";
    const sub = sldIndex > 0 ? labels.slice(0, sldIndex) : [];
    const registrable = sldIndex >= 0 ? labels.slice(sldIndex).join(".") : host;
    return { labels, suffix, suffixLen, sld, sub, registrable, tld: labels[labels.length - 1] };
  }

  function isIPv4(host) {
    return /^\d{1,3}(\.\d{1,3}){3}$/.test(host) && host.split(".").every((p) => Number(p) <= 255);
  }

  function isPrivateIPv4(host) {
    const [a, b] = host.split(".").map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }

  function hostOrSubdomain(host, domain) {
    return host === domain || host.endsWith("." + domain);
  }

  function decodeLabels(labels) {
    return labels.map((ascii) => {
      if (ascii.startsWith("xn--")) {
        const unicode = punycodeDecode(ascii.slice(4));
        return { ascii, unicode: unicode === null ? ascii : unicode, idn: unicode !== null, invalid: unicode === null };
      }
      return { ascii, unicode: ascii, idn: false, invalid: false };
    });
  }

  // ---------------------------------------------------------------- brand logic

  function nameTokens(brand) {
    return [...brand.exact, ...brand.contains];
  }

  /** Does this word contain the brand name, as a whole word or (for long names) inside a longer word? */
  function nameMatch(part, brand) {
    for (const t of brand.exact) {
      if (part === t) return t;
      if (brand.glue && t.length >= 5 && part.length > t.length && (part.startsWith(t) || part.endsWith(t))) return t;
    }
    for (const t of brand.contains) if (part.includes(t)) return t;
    return null;
  }

  function typoAllowed(brand, token) {
    if (brand.typo === false) return false;
    return token.length >= 6 || brand.typo === true;
  }

  function typoMatch(part, brand) {
    if (part.length < 5) return null;
    for (const t of nameTokens(brand)) {
      if (t.length < 5 || !typoAllowed(brand, t)) continue;
      if (part !== t && Math.abs(part.length - t.length) <= 1 && editDistance(part, t) === 1) return t;
    }
    return null;
  }

  /**
   * "sbii", "hdffc", "icicci": a short brand name with one letter typed twice. Short names are too common for general
   * one-letter checks ("sbs", "bbc"), but a doubled letter is a narrow, common trick. Brands marked typo:false are skipped.
   */
  function doubledLetterMatch(part, brand) {
    if (brand.typo === false) return null;
    for (const t of nameTokens(brand)) {
      if (t.length < 3 || part.length !== t.length + 1) continue;
      for (let i = 0; i < t.length; i++) {
        if (t.slice(0, i + 1) + t[i] + t.slice(i + 1) === part) return t;
      }
    }
    return null;
  }

  /** "phonepay": a famous name spelled the way it sounds (listed per brand in url-rules.js). */
  function soundsLikeMatch(part, brand) {
    for (const t of brand.soundsLike || []) if (part === t || (t.length >= 6 && part.includes(t))) return t;
    return null;
  }

  function lookalikeMatch(part, brand) {
    const sk = skeleton(part);
    for (const t of nameTokens(brand)) {
      if (t.length >= 4 && part !== t && sk === t) return t;
    }
    return null;
  }

  /** Any famous name that this plain-text word spells out (used for look-alike letters in international names). */
  function famousNameIn(text) {
    const sk = skeleton(text);
    for (const b of R.BRANDS) {
      for (const t of b.exact) if (sk === t) return b;
      for (const t of b.contains) if (sk.includes(t)) return b;
    }
    return null;
  }

  function partsOf(labels) {
    const out = [];
    for (const l of labels) for (const p of l.split("-")) if (p) out.push(p);
    return out;
  }

  function countKeywords(parts) {
    const found = new Set();
    for (const k of R.KEYWORDS) {
      for (const p of parts) {
        if (p === k || (k.length >= 4 && p.includes(k))) {
          found.add(k);
          break;
        }
      }
    }
    return found.size;
  }

  // ---------------------------------------------------------------- the analysis

  function analyzeParsed(p, mode) {
    const list = [];
    const add = (id, label, why, opts) => {
      const weight = opts && typeof opts.weight === "number" ? opts.weight : W[id];
      list.push({ id, weight, label, why, critical: !!(opts && opts.critical), severity: "info" });
    };

    const host = p.host;
    const display = { host, hostUnicode: host };
    const isV6 = host.startsWith("[");
    const ipv4 = !isV6 && isIPv4(host);
    const single = !isV6 && !ipv4 && !host.includes(".");
    const localName = single || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal") || host.endsWith(".lan");
    let local = false;

    if (isV6) {
      if (host === "[::1]") {
        local = true;
        add("local_address", "Address on your own computer", "This address points to your own device, not to a website on the internet.");
      } else {
        add("ip_ipv6", "Uses a number address instead of a name", "Genuine public websites almost always use a name, not a long number. Routers and test servers sometimes use numbers.");
      }
    } else if (ipv4) {
      if (isPrivateIPv4(host)) {
        local = true;
        add("local_address", "Address on your own network", "This number belongs to your own network (for example a router or office computer), not a public website.");
      } else {
        add("ip_public", "Uses a number address instead of a name", "Banks, shops and government sites use names like sbi.co.in, not numbers. Scammers often use bare numbers to avoid being traced.");
        if (mode === "url" && p.rawHost !== host) {
          add("ip_disguised", "The number address is written in a disguised way", "The address was written in an unusual form that hides that it is just a number.");
        }
      }
    } else if (localName) {
      local = true;
      add("local_address", "A name on your own network", "This looks like a name on your own computer or network, not a public website.");
    }

    // Everything below needs a real domain name.
    let info = null;
    let official = [];
    let restricted = false;
    let brandHit = false;
    let keywordCount = 0;

    if (!isV6 && !ipv4 && !localName) {
      info = splitHost(host);
      const decoded = decodeLabels(info.labels);
      const anyIdn = decoded.some((d) => d.idn || d.invalid);
      if (anyIdn) display.hostUnicode = decoded.map((d) => d.unicode).join(".");

      restricted = R.RESTRICTED_SUFFIXES.some((s) => hostOrSubdomain(host, s));
      official = R.BRANDS.filter((b) => b.domains.some((d) => hostOrSubdomain(host, d)));

      if (official.length) {
        add("known_official", "Matches " + official[0].name + "'s own website", "This address is on Prevenza's short list of real " + official[0].name + " websites. The list is small, so a missing site is not a warning.");
      } else if (restricted) {
        add("restricted_suffix", "Ends in an address ending only certain organisations can register", "Endings such as .gov.in or .bank.in are limited to government bodies and banks, so scammers cannot easily get them.");
      }

      // International (non-English) characters and look-alike letters.
      if (anyIdn && !official.length) {
        let critical = false;
        for (const d of decoded) {
          if (!d.idn) continue;
          const scripts = new Set();
          for (const ch of d.unicode) {
            const s = scriptOf(ch);
            if (s !== "Common") scripts.add(s);
          }
          if (scripts.size >= 2) {
            add("homograph_mixed", "Mixes letters from different alphabets", "One part of this address mixes letters from different alphabets (for example English and Russian letters that look alike). This is a known trick to copy a real website's name.", { critical: true });
            critical = true;
            break;
          }
          const fake = famousNameIn(d.unicode);
          const onlyLookalikeScript = scripts.size === 1 && (scripts.has("Cyrillic") || scripts.has("Greek"));
          const accented = scripts.has("Latin") && d.unicode.normalize("NFD").replace(/[\u0300-\u036f]/g, "") !== d.unicode;
          // "sŋbi": an unusual letter slipped into a famous name. Without the non-English letters it spells the name exactly.
          const plain = d.unicode.replace(/[^a-z0-9]/g, "");
          const inserted = !fake && plain.length >= 3 && plain !== d.unicode && scripts.has("Latin") ? R.BRANDS.find((b) => b.exact.includes(plain) || b.contains.includes(plain)) : null;
          if (inserted) {
            add("homograph_whole", "Hides an unusual letter inside the name " + inserted.name, "Without its unusual letter this address spells " + inserted.name + ". Scammers add a letter that is easy to miss to make a fake site look real.", { critical: true });
            critical = true;
            brandHit = true;
            break;
          }
          if (fake && (onlyLookalikeScript || accented)) {
            add("homograph_whole", "Uses look-alike letters to copy " + fake.name, "The letters in this address look like the name " + fake.name + " but are different characters. Scammers use this to make a fake site look real.", { critical: true });
            critical = true;
            brandHit = true;
            break;
          }
        }
        if (!critical) {
          add("idn", "Uses non-English characters in the address", "Some websites use their own language in the address. That is fine if you expected it, but check that it is the site you meant.");
        }
      }

      // Use the decoded (readable) names for every word check, so punycode's own hyphens never count.
      const uni = decoded.map((d) => d.unicode);
      const subParts = partsOf(uni.slice(0, info.sub.length));
      const sldParts = info.sld ? uni[info.labels.length - info.suffixLen - 1].split("-").filter(Boolean) : [];
      const allParts = partsOf(uni.slice(0, info.labels.length - info.suffixLen));
      keywordCount = official.length || restricted ? 0 : countKeywords(allParts);
      const hyphens = (uni.slice(0, info.labels.length - info.suffixLen).join(".").match(/-/g) || []).length;

      if (!official.length && !restricted) {
        // Famous-name checks. One finding per brand, strongest wins.
        const findings = [];
        for (const b of R.BRANDS) {
          let best = null;
          const consider = (id, weight, label, why) => {
            if (!best || weight > best.weight) best = { id, weight, label, why, brand: b };
          };
          for (const part of subParts) {
            if (nameMatch(part, b)) {
              consider("brand_in_subdomain", W.brand_in_subdomain, "Puts the name " + b.name + " in front of a different website",
                "The name " + b.name + " appears at the start of this address, but the site itself is " + info.registrable + ". Only the last part of an address shows who really owns it.");
            }
          }
          // the whole name without hyphens too, so "axxis-bank" is compared as "axxisbank"
          const sldJoined = sldParts.length > 1 ? [sldParts.join("")] : [];
          for (const part of sldParts.concat(sldJoined)) {
            const doubled = doubledLetterMatch(part, b);
            if (doubled) {
              consider("brand_typosquat", W.brand_typosquat, "Looks like a misspelling of " + b.name,
                "'" + part + "' is '" + doubled + "' with one letter typed twice. Scammers register misspelled names hoping you will not notice.");
            }
            const sounds = soundsLikeMatch(part, b);
            if (sounds) {
              consider("brand_typosquat", W.brand_typosquat, "Spells " + b.name + " the way it sounds",
                "'" + part + "' is how '" + b.name + "' sounds, not how it is spelled. Scammers register names like this to catch people who type by ear.");
            }
          }
          for (const part of sldParts) {
            if (nameMatch(part, b)) {
              consider("brand_in_domain", W.brand_in_domain, "Uses the name " + b.name + " but is not " + b.name + "'s website",
                "The address contains '" + b.name + "', but " + b.name + "'s real websites are different. If you expected " + b.name + ", do not continue. Open its app or type its address yourself.");
            }
            const typo = typoMatch(part, b);
            if (typo) {
              consider("brand_typosquat", W.brand_typosquat, "Looks like a misspelling of " + b.name,
                "'" + part + "' is one letter away from '" + typo + "'. Scammers register misspelled names hoping you will not notice.");
            }
            const look = lookalikeMatch(part, b);
            if (look) {
              consider("brand_lookalike", W.brand_lookalike, "Swaps letters or digits to copy " + b.name,
                "'" + part + "' uses look-alike characters (such as a number 1 for the letter l) to copy '" + look + "'.");
            }
          }
          if (best) findings.push(best);
        }
        findings.sort((a, b) => b.weight - a.weight);
        for (const f of findings.slice(0, 2)) {
          add(f.id, f.label, f.why, { weight: f.weight });
          brandHit = true;
        }
        if (brandHit && keywordCount >= 1) {
          add("brand_with_keyword", "A famous name combined with words like login, verify or KYC", "Real companies rarely put words like 'verify' or 'kyc' next to their name in a different website's address. Scammers do.");
        }

        // A trusted-looking address placed in front of another site: paypal.com.evil.xyz
        const sub = info.sub;
        for (let i = 0; i < sub.length - 1; i++) {
          if (R.TLD_LIKE_LABELS.includes(sub[i + 1]) && sub[i].length > 1) {
            add("misleading_subdomain", "Puts a trusted-looking address in front of another website", "The start of this address looks like a real website (" + sub[i] + "." + sub[i + 1] + "), but the site is really " + info.registrable + ". The real owner is always the last part.");
            break;
          }
        }

        if (info.sub.length >= 4) add("many_subdomains", "Has an unusually long chain of sub-sites", "Very long chains of words separated by dots are a way to hide the real website name.");
        if (host.length > 50) add("long_hostname", "Has a very long website name", "Honest sites usually have short names. Very long names are often used to hide the real owner.");
        if (hyphens >= 3) add("many_hyphens", "Has many hyphens in the name", "Scam sites often string words together with hyphens, like secure-bank-login-update.");
        if (R.SUSPICIOUS_TLDS.includes(info.tld)) add("suspicious_tld", "Ends in .{tld}, an ending scammers use a lot".replace("{tld}", info.tld), "Many honest sites use this ending too, so on its own this proves nothing. It matters more together with other signs.");
        if (FREE.has(info.suffix)) add("free_hosting", "Is a free page on a hosting service", "Anyone can create a page here for free, so the name does not show a real company's website.");
        if (keywordCount >= 2 || (keywordCount >= 1 && hyphens >= 1)) {
          add("keywords", "Contains words scammers often use", "Words like login, verify, update or KYC appear in the address. Real companies use them too, so this only matters together with other signs.");
        }
        if (R.SHORTENERS.some((s) => hostOrSubdomain(host, s))) {
          add("shortener", "A link shortener hides where this really goes", "Short links such as bit.ly can lead anywhere. Scammers use them to hide the real address. Ask the sender for the full link.");
        }
      }
    }

    if (mode === "url") {
      if (p.username || p.password) {
        const user = decodeURIComponent(safeDecode(p.username));
        const looksLikeSite = /[a-z0-9-]+\.[a-z]{2,}/i.test(user);
        if (looksLikeSite) {
          add("at_sign_domain", "The @ sign hides the real website", "In a web address, everything before the @ is just a name tag and is ignored. The real website here is " + host + ", not '" + user + "'.", { critical: true });
        } else {
          add("credentials", "Contains a username inside the address", "Honest links almost never put a username in the address. It can be used to confuse you about where the link goes.");
        }
      } else if (p.hasAtAfterAuthority) {
        add("at_in_path", "Contains an @ sign later in the address", "An @ sign inside a link can be used to confuse you about where it goes. Be careful with it.");
      }
      if (p.hasBackslash) {
        add("backslash", "Contains a backslash that can disguise the real website", "Browsers treat a backslash like a slash, so text after it can look like the site name but is not. The real website here is " + host + ".");
      }
      if (p.port && !local) add("unusual_port", "Uses an unusual connection number", "Normal websites do not show a port number such as :8080. Some test sites and scams do.");
      const pct = ((p.path + p.search).match(/%[0-9a-f]{2}/gi) || []).length;
      if (pct > 8) add("encoded_chars", "Contains a lot of hidden-character codes", "Long strings of codes like %2F can hide what the link really contains.");
      try {
        for (const [key, value] of new URLSearchParams(p.search)) {
          if (R.REDIRECT_PARAMS.includes(key.toLowerCase()) && /^((https?:)?\/\/|https?%3a)/i.test(value)) {
            add("redirect_param", "Passes you on to another website", "This link carries a second address inside it and may send you there. Check where you end up.");
            break;
          }
        }
      } catch (e) {
        /* an odd query string is not a reason to warn */
      }
    }

    if (p.scheme === "http:" && !local) {
      add("no_https", "Not encrypted (plain http)", "Anything you type on this page could be seen by others on the network. Many small old sites are like this, so it is only a minor sign.");
    }

    // Score and level
    let score = list.reduce((sum, i) => sum + i.weight, 0);
    if (mode === "url" && score >= R.THRESHOLDS.medium) {
      const text = (p.path + " " + p.search).toLowerCase();
      if (R.PATH_KEYWORDS.some((k) => text.includes(k))) {
        add("path_keywords", "The link asks for a login, verification or payment", "Words like login or verify in the link matter here because the address already has other warning signs.");
        score += W.path_keywords;
      }
    }
    score = Math.max(0, Math.round(score * 10) / 10);
    const critical = list.some((i) => i.critical);
    const level = critical || score >= R.THRESHOLDS.high ? "high" : score >= R.THRESHOLDS.medium ? "medium" : "low";

    for (const i of list) i.severity = i.critical || i.weight >= 5 ? "high" : i.weight >= 2 ? "medium" : i.weight > 0 ? "low" : "info";
    list.sort((a, b) => (b.weight > 0 ? 1 : 0) - (a.weight > 0 ? 1 : 0) || b.weight - a.weight);
    const ordered = list.filter((i) => i.weight > 0).concat(list.filter((i) => i.weight <= 0).sort((a, b) => b.weight - a.weight));

    return {
      ok: true,
      mode,
      level,
      label: URL_RISK[level].label,
      score,
      summary: SUMMARY[level],
      host: display.host,
      hostUnicode: display.hostUnicode,
      scheme: p.scheme,
      assumedScheme: !!p.assumedScheme,
      indicators: ordered.map((i) => ({ id: i.id, severity: i.severity, weight: i.weight, label: i.label, why: i.why, critical: !!i.critical })),
    };
  }

  function safeDecode(text) {
    try {
      return decodeURIComponent(text);
    } catch (e) {
      return text;
    }
  }

  // ---------------------------------------------------------------- public API

  /** The permitted signal from a web page: site name and protocol only. Never throws. */
  function analyzeSite(input) {
    try {
      if (input === null || typeof input !== "object" || Array.isArray(input)) return fail("invalid");
      if (typeof input.hostname !== "string" || (input.protocol !== "http:" && input.protocol !== "https:")) return fail("invalid");
      const host = input.hostname.trim().toLowerCase();
      if (!host || host.length > R.LIMITS.maxHostnameLength || /[^a-z0-9.\-_[\]:]/.test(host)) return fail("invalid");
      let url;
      try {
        url = new URL(input.protocol + "//" + host + "/");
      } catch (e) {
        return fail("invalid");
      }
      const parsed = buildParsed(url, input.protocol + "//" + host + "/", false);
      if (!parsed.ok) return parsed;
      return analyzeParsed(parsed, "site");
    } catch (e) {
      return fail("invalid");
    }
  }

  /** A full address the user typed or pasted. Never throws. */
  function analyzeUrl(input) {
    try {
      const parsed = parseUrl(input);
      if (!parsed.ok) return parsed;
      return analyzeParsed(parsed, "url");
    } catch (e) {
      return fail("invalid");
    }
  }

  return { analyzeSite, analyzeUrl, parseUrl, splitHost, punycodeDecode, skeleton, editDistance, scriptOf, URL_RISK, SUMMARY, ERRORS };
});

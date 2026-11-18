// Step 8: Elder Mode (elder-text.js, holdy.js elder model, i18n.js, family guide privacy). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Y = require("../src/shared/holdy.js");
const ET = require("../src/shared/elder-text.js");
const I18N = require("../src/shared/i18n.js");
const E = require("../src/shared/risk-engine.js");
const M = require("../src/shared/message-scan.js");
const urlIntel = require("../src/shared/url-intel.js");
const S = require("../src/shared/settings.js");
const C = require("../src/shared/constants.js");

const root = path.join(__dirname, "..");
const ind = (id, weight, extra) => Object.assign({ id, label: "Label " + id, why: "Why " + id, weight }, extra || {});
const assess = (module, ...indicators) => E.assess({ [module]: { ok: true, indicators } });
const fromMessage = (text) => E.assess({ message: { ok: true, indicators: M.scanMessage(text).indicators } });
const fromUrl = (url) => E.assess({ url: { ok: true, indicators: urlIntel.analyzeUrl(url).indicators } });
const sentences = (s) => s.split(/(?<=[.!?\u0964])\s+/).filter(Boolean);

// ------------------------------------------------------------------ the text
function shape(o) {
  if (Array.isArray(o)) return o.map(shape);
  if (o && typeof o === "object") return Object.fromEntries(Object.keys(o).sort().map((k) => [k, shape(o[k])]));
  return typeof o;
}

test("Hindi and Tamil have exactly the same topics, labels, steps and guide points as English", () => {
  assert.deepEqual(shape(ET.hi), shape(ET.en));
  assert.deepEqual(shape(ET.ta), shape(ET.en));
  for (const lang of ["en", "hi", "ta"]) {
    for (const [topic, t] of Object.entries(ET[lang].topics)) {
      assert.ok(t.steps.length >= 1 && t.steps.length <= 2, lang + " " + topic + " must have one or two steps");
      for (const s of [t.found, t.why, ...t.steps]) assert.ok(s.length > 0, lang + " " + topic);
    }
    assert.equal(ET[lang].family.points.length, ET.en.family.points.length, lang);
  }
});

test("Hindi text is in Devanagari and Tamil text is in Tamil script", () => {
  const dev = /[\u0900-\u097f]/;
  const tam = /[\u0b80-\u0bff]/;
  const all = (set) => [...Object.values(set.topics).flatMap((t) => [t.found, t.why, ...t.steps]), ...Object.values(set.labels), set.family.title, set.family.intro, ...set.family.points, set.family.footer, set.family.show, set.family.hide];
  for (const s of all(ET.hi)) assert.match(s, dev, s);
  for (const s of all(ET.ta)) assert.match(s, tam, s);
});

test("the wording is plain: short sentences, no technical terms", () => {
  const technical = /\b(domain|impersonat\w*|credential\w*|harvest\w*|phishing|malware|encrypt\w*|ssl|tls|url|dns|homograph|punycode|algorithm|heuristic|spoof\w*|ip address|redirect\w*|authenticat\w*)\b/i;
  const all = [...Object.values(ET.en.topics).flatMap((t) => [t.found, t.why, ...t.steps]), ...Object.values(ET.en.labels), ...ET.en.family.points, ET.en.family.intro, ET.en.family.footer];
  for (const text of all) {
    assert.doesNotMatch(text, technical, text);
    for (const sentence of sentences(text)) assert.ok(sentence.split(/\s+/).length <= 24, "long sentence: " + sentence);
  }
});

test("the wording is calm and honest: never 'safe', never frightening, never claims Prevy acts", () => {
  const all = [...Object.values(ET.en.topics).flatMap((t) => [t.found, t.why, ...t.steps]), ...Object.values(ET.en.labels), ...ET.en.family.points, ET.en.family.intro, ET.en.family.footer, ET.en.family.show, ET.en.family.hide];
  for (const text of all) {
    assert.doesNotMatch(text.replace(/"safe account"|no safe account/gi, ""), /\bsafe\b|\bguarantee\w*|100%/i, "mentions safe: " + text);
    assert.doesNotMatch(text, /\b(idiot|stupid|fool\w*|you will lose everything|act now|hurry|panic)\b/i, text);
    assert.doesNotMatch(text, /\b(prevenza|prevy|we)\b[^.]{0,30}\b(will|can|has)\s+(block|cancel|stop|reverse|contact|call|send|alert|notify)/i, text);
  }
  // The only "safe" words are the scam's own phrase ("safe account") and the sentence that says there is no such thing.
  assert.match(ET.en.topics.safe_account.why, /There is no safe account/);
});

test("the three required family guidance sentences are present, word for word", () => {
  const p = ET.en.family.points;
  assert.ok(p.includes("Before sending money, call someone you trust using a number you already know."));
  assert.ok(p.includes("Do not use phone numbers provided in suspicious messages."));
  assert.ok(p.includes("Verify bank-related requests using your bank's official contact details."));
});

test("the family guide holds no phone number, address or contact detail and asks for none", () => {
  for (const lang of ["en", "hi", "ta"]) {
    const f = ET[lang].family;
    const text = [f.title, f.intro, ...f.points, f.footer, f.show, f.hide].join(" ");
    assert.doesNotMatch(text, /\d{4,}/, lang + " has a long number");
    assert.doesNotMatch(text, /@|https?:|tel:|sms:|mailto:|whatsapp/i, lang);
  }
  assert.match(ET.en.family.footer, /does not contact anyone/);
  assert.match(ET.en.family.footer, /does not save phone numbers or send messages/);
});

// ------------------------------------------------------------------ the model
test("elder off: no elder model at all (normal mode is unchanged)", () => {
  const a = assess("message", ind("msg_otp_request", 6));
  assert.equal(Y.build(a, { context: "message" }).elder, null);
  assert.equal(Y.build(a, { context: "message", elder: false }).elder, null);
  assert.equal(Y.build(assess("message", ind("msg_kyc_update", 1)), { context: "message" }).elder, null);
});

test("elder on: the user's own examples appear, in short plain sentences", () => {
  const secret = Y.build(assess("message", ind("msg_otp_request", 6)), { context: "message", elder: true });
  assert.equal(secret.elder.found, "Someone may be trying to steal your password or OTP. Never share these details.");
  const site = Y.build(fromUrl("https://sbi-kyc-update.xyz/login"), { context: "url", elder: true });
  assert.equal(site.elder.topic, "site_fake");
  assert.match(site.elder.found, /may be pretending to be your bank/);
  assert.equal(site.elder.steps[0], "Do not enter your bank details until you check the official website.");
  const upi = Y.build(assess("payment", ind("upi_handle_lookalike", 3.5)), { context: "upi", elder: true });
  assert.equal(upi.elder.topic, "upi");
  assert.equal(upi.elder.found, "Check who will receive your money before paying.");
});

test("elder on: every warning explains what was found, why, and gives one or two steps", () => {
  const cases = [
    ["message", assess("message", ind("msg_otp_request", 6))],
    ["message", assess("message", ind("msg_digital_arrest", 8, { critical: true }))],
    ["message", assess("message", ind("msg_kyc_update", 3), ind("msg_account_block", 3))],
    ["message", assess("message", ind("msg_kyc_update", 3))],
    ["url", fromUrl("https://sbi-kyc-update.xyz/login")],
    ["url", fromUrl("https://bit.ly/abc123")],
    ["upi", assess("payment", ind("upi_handle_lookalike", 3.5))],
    ["screenshot", assess("screenshot", ind("shot_payment_instruction", 6))],
  ];
  let cards = 0;
  for (const [context, a] of cases) {
    const m = Y.build(a, { context, elder: true });
    if (m.show !== "card") continue;
    cards++;
    assert.ok(m.elder.found && m.elder.why, context + " " + m.category);
    assert.ok(m.elder.steps.length >= 1 && m.elder.steps.length <= 2, context + " " + m.category);
    assert.ok(m.elder.labels.found && m.elder.labels.why && m.elder.labels.todo && m.elder.labels.trust, "labels");
    assert.equal(m.elder.family.points.length, 5);
  }
  assert.ok(cards >= 5, "expected at least five cards, got " + cards);
});

test("elder on keeps the engine's category, tier, key and every Step 7 field exactly as in normal mode", () => {
  const a = assess("message", ind("msg_otp_request", 6), ind("msg_urgency", 3));
  const normal = Y.build(a, { context: "message", elder: false });
  const elder = Y.build(a, { context: "message", elder: true });
  for (const k of ["category", "tier", "levelLabel", "tierLabel", "key", "show", "urgent", "lead", "headline", "actions", "disclaimer"]) assert.deepEqual(elder[k], normal[k], k);
});

test("elder on does not change the assessment or the thresholds", () => {
  const a = assess("message", ind("msg_otp_request", 6));
  const before = JSON.stringify(a);
  Y.build(a, { context: "message", elder: true, language: "ta" });
  assert.equal(JSON.stringify(a), before);
});

test("the topic comes from the evidence: a topic is used only when matching evidence exists", () => {
  const plain = Y.build(assess("message", ind("msg_kyc_update", 3)), { context: "message", elder: true });
  assert.notEqual(plain.elder.topic, "secret");
  assert.notEqual(plain.elder.topic, "arrest");
  const arrest = Y.build(assess("message", ind("msg_digital_arrest", 8, { critical: true })), { context: "message", elder: true });
  assert.equal(arrest.elder.topic, "arrest");
  const shortener = Y.build(fromUrl("https://bit.ly/abc123"), { context: "url", elder: true });
  if (shortener.show === "card") assert.equal(shortener.elder.topic, "site_odd");
});

test("broad headlines are refined by the evidence: prize fees, fake helplines and money requests get their own plain topic", () => {
  const topic = (text) => Y.build(fromMessage(text), { context: "message", elder: true }).elder.topic;
  assert.equal(topic("Congratulations! You have won the lucky draw jackpot of 25 lakh. Pay the processing fee to claim your prize."), "receive");
  assert.equal(topic("Call this customer care number to fix your account, install AnyDesk"), "helpline");
  assert.equal(topic("Hi mom I lost my phone, urgent send money to this number"), "money_request");
  assert.equal(topic("Your KYC is pending, please update it."), "fee");
});

test("LOW and INCONCLUSIVE stay small notes in elder mode and are never called safe", () => {
  const low = Y.build(fromMessage("Hi, are we meeting for lunch tomorrow?"), { context: "message", elder: true });
  assert.equal(low.tier, "info");
  assert.equal(low.show, "note");
  assert.match(low.note, /not a guarantee/);
  assert.match(low.elder.extra, /check for yourself with the real bank or company/);
  assert.doesNotMatch(low.note + " " + low.elder.extra, /\bsafe\b/i);
  assert.equal(low.elder.trust, false);

  const unsure = Y.build(E.assess({ screenshot: { unavailable: true, reason: "No readable text." } }), { context: "screenshot", elder: true });
  assert.equal(unsure.tier, "uncertain");
  assert.equal(unsure.show, "note");
  assert.match(unsure.note, /does not mean it is safe/);
  assert.match(unsure.elder.extra, /ask someone you trust/);
  assert.equal(unsure.elder.trust, true);
  assert.doesNotMatch(unsure.elder.extra, /\bsafe\b/i);
});

test("LOW, MEDIUM, HIGH, CRITICAL and INCONCLUSIVE keep their tiers in elder mode", () => {
  const tiers = {
    LOW: Y.build(fromMessage("Hi, are we meeting for lunch tomorrow?"), { context: "message", elder: true }),
    MEDIUM: Y.build(assess("message", ind("msg_kyc_update", 3)), { context: "message", elder: true }),
    HIGH: Y.build(assess("message", ind("msg_kyc_update", 3), ind("msg_account_block", 3)), { context: "message", elder: true }),
    CRITICAL: Y.build(assess("message", ind("msg_digital_arrest", 8, { critical: true })), { context: "message", elder: true }),
    INCONCLUSIVE: Y.build(E.assess({ screenshot: { unavailable: true, reason: "No readable text." } }), { context: "screenshot", elder: true }),
  };
  const want = { LOW: "info", MEDIUM: "caution", HIGH: "warning", CRITICAL: "stop", INCONCLUSIVE: "uncertain" };
  for (const [cat, m] of Object.entries(tiers)) {
    assert.equal(m.category, cat);
    assert.equal(m.tier, want[cat], cat);
  }
});

test("no result still means Prevy says nothing in elder mode", () => {
  for (const bad of [null, undefined, {}, { category: "NOPE" }]) {
    const m = Y.build(bad, { context: "message", elder: true });
    assert.equal(m.show, false);
    assert.equal(m.elder, undefined);
  }
});

test("Hindi and Tamil choose their own elder text, and unknown languages fall back to English", () => {
  const a = assess("message", ind("msg_otp_request", 6));
  assert.match(Y.build(a, { context: "message", language: "hi", elder: true }).elder.found, /[\u0900-\u097f]/);
  assert.match(Y.build(a, { context: "message", language: "ta", elder: true }).elder.found, /[\u0b80-\u0bff]/);
  assert.equal(Y.build(a, { context: "message", language: "fr", elder: true }).elder.found, ET.en.topics.secret.found);
  assert.equal(Y.build(a, { context: "message", language: "hinglish", elder: true }).elder.found, ET.en.topics.secret.found);
});

// ------------------------------------------------------------------ interface labels
test("every English interface label exists in Hindi and Tamil, in the right script", () => {
  const dev = /[\u0900-\u097f]/;
  const tam = /[\u0b80-\u0bff]/;
  assert.deepEqual(Object.keys(I18N.TABLE.hi).sort(), Object.keys(I18N.TABLE.en).sort());
  assert.deepEqual(Object.keys(I18N.TABLE.ta).sort(), Object.keys(I18N.TABLE.en).sort());
  for (const key of Object.keys(I18N.TABLE.en)) {
    assert.match(I18N.TABLE.hi[key], dev, "hi " + key);
    assert.match(I18N.TABLE.ta[key], tam, "ta " + key);
  }
});

test("t() falls back to English for unknown languages and unknown keys give an empty string", () => {
  assert.equal(I18N.t("fr", "nav_settings"), "Settings");
  assert.equal(I18N.t("hinglish", "nav_settings"), "Settings");
  assert.equal(I18N.t("hi", "nav_settings"), I18N.TABLE.hi.nav_settings);
  assert.equal(I18N.t("en", "no_such_key"), "");
});

test("apply() swaps the text, then restores English exactly", () => {
  const make = (key, text) => {
    const attrs = { "data-i18n": key };
    return { textContent: text, getAttribute: (k) => (k in attrs ? attrs[k] : null), setAttribute: (k, v) => { attrs[k] = String(v); }, hasAttribute: (k) => k in attrs };
  };
  const a = make("nav_settings", "Settings");
  const b = make("dash_link", "Check a link");
  const root = { querySelectorAll: () => [a, b] };
  assert.equal(I18N.apply(root, "hi"), 2);
  assert.equal(a.textContent, I18N.TABLE.hi.nav_settings);
  assert.equal(I18N.apply(root, "ta"), 2);
  assert.equal(b.textContent, I18N.TABLE.ta.dash_link);
  assert.equal(I18N.apply(root, "en"), 2);
  assert.equal(a.textContent, "Settings");
  assert.equal(b.textContent, "Check a link");
  assert.equal(I18N.apply(root, "fr"), 0);
  assert.equal(I18N.apply(null, "hi"), 0);
});

test("every data-i18n key used in a page exists, and its English text matches the table", () => {
  const dirs = ["popup", "dashboard", "settings"];
  let used = 0;
  for (const d of dirs) {
    const html = fs.readFileSync(path.join(root, "src", d, d + ".html"), "utf8");
    for (const m of html.matchAll(/data-i18n="([a-z_]+)"[^>]*>([^<]*)</g)) {
      used++;
      assert.ok(m[1] in I18N.TABLE.en, d + " uses unknown key " + m[1]);
      assert.equal(m[2].replace(/&#?\w+;/g, "'").trim(), I18N.TABLE.en[m[1]].replace(/'/g, "'"), d + " " + m[1]);
    }
  }
  assert.ok(used >= 25, "expected at least 25 labelled elements, found " + used);
});

// ------------------------------------------------------------------ settings and privacy
test("Elder Mode and language are ordinary settings; nothing new is stored", () => {
  const keys = Object.keys(C.DEFAULT_SETTINGS).sort();
  assert.deepEqual(keys, ["elderMode", "enabled", "language", "mutedSites", "pageWarnings", "sensitivity", "showAssistantBadge"]); // pageWarnings: Step 12
  assert.equal(C.DEFAULT_SETTINGS.elderMode, false);
  assert.equal(S.sanitizeSettings({ elderMode: true }).elderMode, true);
  assert.equal(S.sanitizeSettings({ elderMode: "yes" }).elderMode, false);
  assert.deepEqual(Object.keys(S.sanitizeSettings({})).sort(), keys);
});

test("settings drop anything that looks like a contact, a scan or a family member", () => {
  const out = S.sanitizeSettings({ elderMode: true, familyPhone: "9876543210", trustedContact: "Asha", lastUrl: "http://x.test", message: "otp 1234", dismissed: ["a"] });
  assert.deepEqual(Object.keys(out).sort(), Object.keys(C.DEFAULT_SETTINGS).sort());
  assert.doesNotMatch(JSON.stringify(out), /9876543210|Asha|x\.test|1234/);
});

test("the interface languages are English, Hindi and Tamil; Hinglish is for message checking only", () => {
  assert.deepEqual(C.LANGUAGES.map((l) => l.id), ["en", "hi", "ta"]);
  assert.ok(C.SCAN_LANGUAGES.some((l) => l.id === "hinglish"));
  assert.equal(S.sanitizeSettings({ language: "hinglish" }).language, "en");
  for (const id of ["en", "hi", "ta"]) assert.equal(S.sanitizeSettings({ language: id }).language, id);
});

test("the family guide code has no inputs, links, phone or message actions and no storage", () => {
  const code = fs.readFileSync(path.join(root, "src", "shared", "family-guide.js"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
  assert.doesNotMatch(code, /createElement\(\s*["'](input|textarea|select|a|form|iframe)["']/);
  assert.doesNotMatch(code, /\bhref\b|tel:|sms:|mailto:|whatsapp|window\.open|location\.|chrome\.|\bfetch\b|localStorage|sessionStorage|indexedDB|navigator\./i);
  assert.doesNotMatch(code, /\.value\b/);
});

test("nothing in the source can start a call, a text, an email or a chat", () => {
  const walk = (dir, acc = []) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full, acc);
      else if (/\.(js|html)$/.test(e.name)) acc.push(full);
    }
    return acc;
  };
  for (const f of walk(path.join(root, "src"))) {
    const code = fs.readFileSync(f, "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
    assert.doesNotMatch(code, /["'`](tel|sms|mailto|whatsapp|intent):/i, path.relative(root, f));
    assert.doesNotMatch(code, /chrome\.(contacts|gcm|notifications|runtime\.sendNativeMessage)/i, path.relative(root, f));
  }
});

test("the manifest still asks for storage only, and the CSP still blocks the network", () => {
  const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.optional_permissions, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
});

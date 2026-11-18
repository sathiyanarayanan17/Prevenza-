// Step 9: Emergency Help (emergency.js content and rules, the page, the buttons, privacy). Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const E = require("../src/shared/emergency.js");
const I18N = require("../src/shared/i18n.js");
const manifest = require("../manifest.json");

const root = path.join(__dirname, "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");
const strip = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
const allText = (incident) => [incident.label, incident.title, ...incident.steps, ...incident.elderSteps].join(" ");

// ------------------------------------------------------------------ official details
test("official details are exactly the ones supplied: the portal address and helpline 1930", () => {
  assert.equal(E.OFFICIAL.portalUrl, "https://cybercrime.gov.in/");
  assert.equal(E.OFFICIAL.helplineNumber, "1930");
  assert.equal(E.OFFICIAL.portalName, "National Cyber Crime Reporting Portal");
  assert.deepEqual(Object.keys(E.OFFICIAL).sort(), ["helplineName", "helplineNumber", "portalName", "portalUrl"]);
});

test("the content is frozen so code cannot change it by accident", () => {
  assert.ok(Object.isFrozen(E.OFFICIAL) && Object.isFrozen(E.TEXT) && Object.isFrozen(E.INCIDENTS) && Object.isFrozen(E.INCIDENTS[0].steps));
  assert.throws(() => { "use strict"; E.OFFICIAL.helplineNumber = "100"; });
});

test("no other phone number or web address appears in the emergency content", () => {
  const everything = JSON.stringify({ t: E.TEXT, i: E.INCIDENTS, s: E.TRUST_SENTENCE });
  assert.doesNotMatch(everything, /https?:\/\//i);
  assert.doesNotMatch(everything, /\bwww\./i);
  const numbers = (everything.match(/\d[\d\s-]{1,}\d/g) || []).map((n) => n.replace(/\D/g, ""));
  // only the "Step {n} of {total}" placeholders contain no digits; the only digits allowed are the helpline number
  for (const n of numbers) assert.equal(n, "1930");
  assert.doesNotMatch(everything, /\b(100|101|102|108|112|181)\b/);
  assert.doesNotMatch(everything, /\bverified\b|\bcertified\b|\bguaranteed to work\b/i);
});

// ------------------------------------------------------------------ incident categories
test("the seven incident categories exist, with unique ids", () => {
  assert.deepEqual(E.INCIDENTS.map((i) => i.id), ["money", "otp_pin", "link", "fake_kyc", "arrest", "fake_receipt", "other"]);
  assert.equal(new Set(E.INCIDENTS.map((i) => i.id)).size, 7);
  for (const i of E.INCIDENTS) {
    assert.ok(i.label && i.title, i.id);
    assert.ok(i.steps.length >= 4 && i.steps.length <= 5, i.id + " steps");
    assert.ok(i.elderSteps.length >= 4 && i.elderSteps.length <= 5, i.id + " elder steps");
  }
});

const must = (id, list, elder) => {
  const text = E.stepsFor(id, elder).join(" ");
  for (const re of list) assert.match(text, re, id + (elder ? " (elder) " : " ") + re);
};

test("A. sent money: stop, bank, official report, evidence, no paid recovery", () => {
  must("money", [/Stop sending any more money/, /Contact your bank immediately/, /official contact details/, /official reporting channel/, /reference numbers/, /guaranteed recovery.*upfront fee/]);
  must("money", [/Do not send any more money/, /Call your bank now/, /Report it/, /Keep the payment details/, /for a fee, do not pay/], true);
});

test("B. shared OTP or UPI PIN: bank, secure the account, reset only through official channels, never share again", () => {
  must("otp_pin", [/Contact your bank immediately/, /Follow the bank's instructions to secure your account/, /official banking channels/, /Never share another OTP or PIN/]);
  must("otp_pin", [/Call your bank now/, /Do not tell any other OTP or PIN/], true);
});

test("C. suspicious link: stop entering details, close, contact the bank if credentials were entered, no unknown downloads", () => {
  must("link", [/Do not enter any more personal or banking information/, /Close the suspicious page/, /entered a password, card details or other login details, contact the relevant bank or service immediately/, /Do not download unknown files or install unknown apps/]);
  must("link", [/Close the page/, /call your bank or that service now/, /Do not download files or install apps/], true);
});

test("fake bank or KYC message: no links, no sharing, check with official contact details", () => {
  must("fake_kyc", [/Do not tap links/, /Do not share OTPs, PINs, passwords or card details/, /official contact details/, /contact your bank immediately/]);
  must("fake_kyc", [/Do not tap the link/, /call your bank/], true);
});

test("D. digital arrest: calm, no money, no details, verify independently, seek official and trusted help", () => {
  must("arrest", [/Stay calm/, /Do not transfer money because of threats/, /Do not share OTPs, PINs or personal information/, /Verify the situation independently/, /official authorities and trusted people/]);
  must("arrest", [/Stay calm/, /Do not send money because of threats/, /Hang up/, /someone you trust/], true);
});

test("E. fake payment screenshot: do not release goods, check your own app, confirm the money arrived", () => {
  must("fake_receipt", [/Do not hand over goods or services based only on a screenshot/, /Check your own bank or UPI application/, /actually arrived/]);
  must("fake_receipt", [/Do not give the goods yet/, /own bank or UPI app/, /really arrived/], true);
});

test("other suspicious activity: pause, verify independently, ask someone you trust", () => {
  must("other", [/Pause/, /Verify independently/, /someone you trust/, /contact your bank immediately/]);
  must("other", [/Pause/, /Ask someone you trust/], true);
});

test("Elder Mode steps are shorter in total and each step is short", () => {
  for (const i of E.INCIDENTS) {
    const normal = i.steps.join(" ").length;
    const elder = i.elderSteps.join(" ").length;
    assert.ok(elder < normal, i.id + ": elder text should be shorter (" + elder + " vs " + normal + ")");
    for (const s of i.elderSteps) assert.ok(s.length <= 170, i.id + " elder step too long: " + s);
  }
});

// ------------------------------------------------------------------ safe and honest wording
test("the guidance never promises recovery, freezing or reversal, and says plainly that Prevenza cannot do these", () => {
  assert.match(E.TEXT.limits, /cannot freeze accounts, reverse payments or recover money/);
  for (const i of E.INCIDENTS) {
    const text = allText(i);
    assert.doesNotMatch(text, /we will (recover|freeze|reverse|get)|will be (refunded|recovered|reversed)|Prevenza (will|can) (freeze|recover|reverse|block|cancel)/i, i.id);
    // "guaranteed recovery" appears only as a warning against paying for it
    for (const s of [...i.steps, ...i.elderSteps].filter((x) => /guarantee|get your money back/i.test(x))) assert.match(s, /not trust|do not pay/i, i.id + ": " + s);
  }
});

test("the guidance never asks the user to type or share an OTP, PIN, password, card or contact", () => {
  for (const i of E.INCIDENTS) {
    for (const s of [...i.steps, ...i.elderSteps].filter((x) => /\b(OTP|PIN|password)\b/i.test(x))) {
      // every sentence that mentions an OTP, PIN or password is a warning, an instruction to contact the bank, or a reset through the bank
      assert.match(s, /\b(Do not|Never|not|Contact|Call|Change|Follow|credentials|Check|entered|typed|shared|missing)\b/i, i.id + ": " + s);
    }
  }
});

test("the trust guidance is exactly the specified sentence", () => {
  assert.equal(
    E.TRUST_SENTENCE,
    "Pause before taking action. Contact someone you trust using a phone number you already know. Do not use contact details supplied in a suspicious message."
  );
  assert.equal(E.TEXT.trustHeading, "Ask someone you trust");
});

test("reporting text: report quickly, bank too, and nothing is submitted or called for the user", () => {
  assert.match(E.TEXT.reportIntro, /as quickly as possible/);
  assert.match(E.TEXT.reportIntro, /bank immediately/);
  assert.match(E.TEXT.bankReminder, /bank immediately/);
  assert.match(E.TEXT.portalHelp, /Nothing is sent or filed until you do it yourself/);
  assert.match(E.TEXT.helplineHelp, /never makes the call/);
  assert.match(E.TEXT.copied, /Nothing was called or sent/);
  assert.match(E.TEXT.copyFailed, /1930/);
});

// ------------------------------------------------------------------ choosing an incident
test("getIncident accepts only known ids (invalid selections return null)", () => {
  for (const bad of [undefined, null, 0, 7, {}, [], ["money"], "", "Money", " money", "money ", "unknown", "__proto__", "constructor", "toString", "hasOwnProperty", "<script>", "money#", "../money"]) {
    assert.equal(E.getIncident(bad), null, JSON.stringify(bad));
    assert.deepEqual(E.stepsFor(bad, false), [], JSON.stringify(bad));
    assert.deepEqual(E.stepsFor(bad, true), [], JSON.stringify(bad));
  }
  for (const i of E.INCIDENTS) assert.equal(E.getIncident(i.id), i);
});

test("stepsFor picks the short list in Elder Mode and the full list otherwise", () => {
  for (const i of E.INCIDENTS) {
    assert.equal(E.stepsFor(i.id, true), i.elderSteps);
    assert.equal(E.stepsFor(i.id, false), i.steps);
  }
});

test("parseHash: nothing, a known incident, or invalid", () => {
  assert.deepEqual(E.parseHash(""), { state: "none" });
  assert.deepEqual(E.parseHash("#"), { state: "none" });
  assert.deepEqual(E.parseHash(undefined), { state: "none" });
  assert.deepEqual(E.parseHash(null), { state: "none" });
  assert.deepEqual(E.parseHash("#money"), { state: "valid", id: "money" });
  assert.deepEqual(E.parseHash("#arrest"), { state: "valid", id: "arrest" });
  for (const bad of ["#nonsense", "#MONEY", "#money%20", "#__proto__", "#constructor", "#a/b"]) assert.deepEqual(E.parseHash(bad), { state: "invalid" }, String(bad));
  for (const notText of [42, {}, []]) assert.deepEqual(E.parseHash(notText), { state: "none" });
});

test("stepLabel", () => {
  assert.equal(E.stepLabel(2, 5), "Step 2 of 5");
});

// ------------------------------------------------------------------ labels in the three languages
test("the Emergency Help button and the return link have Hindi and Tamil labels", () => {
  for (const k of ["emergency_btn", "emg_back"]) {
    assert.ok(I18N.TABLE.en[k], k);
    assert.match(I18N.TABLE.hi[k], /[\u0900-\u097f]/, "hi " + k);
    assert.match(I18N.TABLE.ta[k], /[\u0b80-\u0bff]/, "ta " + k);
  }
  assert.equal(I18N.TABLE.en.emergency_btn, "Emergency Help");
  assert.equal(I18N.TABLE.en.emg_back, "Return to dashboard");
});

test("the page is honest that the emergency steps are English only", () => {
  assert.match(E.TEXT.languageNote, /in English for now/);
  assert.doesNotMatch(E.TEXT.languageNote, /translated|fully/i);
  assert.ok(!("hi" in E) && !("ta" in E));
});

// ------------------------------------------------------------------ the page and the buttons
test("the Emergency Help page is CSP-safe and collects nothing", () => {
  const html = read("src/emergency/emergency.html");
  assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i);
  assert.doesNotMatch(html, /\son[a-z]+\s*=/i);
  assert.doesNotMatch(html, /\sstyle\s*=/i);
  assert.doesNotMatch(html, /<style[\s>]/i);
  assert.match(html, /<meta name="viewport"/);
  // no way to type anything: no inputs, text boxes, selects, forms or file pickers
  assert.doesNotMatch(html, /<(input|textarea|select|form)\b/i);
  assert.doesNotMatch(html, /type="(tel|email|password|file)"/i);
  // no addresses in the page itself: the portal address comes only from emergency.js
  assert.doesNotMatch(html, /https?:\/\/|tel:|sms:|mailto:|whatsapp/i);
  for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css|html))"/g)) {
    const target = path.normalize(path.join(root, "src", "emergency", m[1]));
    assert.ok(fs.existsSync(target), "missing: " + m[1]);
  }
  // external link attributes
  assert.match(html, /id="portal-link"[^>]*target="_blank"[^>]*rel="noopener noreferrer"/);
});

test("the page script stores nothing, sends nothing and never dials or messages", () => {
  const code = strip(read("src/emergency/emergency.js")) + strip(read("src/shared/emergency.js"));
  for (const re of [/chrome\.storage/, /localStorage|sessionStorage|indexedDB/, /\bfetch\s*\(/, /XMLHttpRequest|WebSocket|sendBeacon/, /tel:|sms:|mailto:|whatsapp|intent:/i, /window\.open|location\.href\s*=|location\.assign|location\.replace/, /chrome\.tabs|chrome\.runtime\.sendMessage|chrome\.permissions/, /\.innerHTML|eval\(|document\.write/]) {
    assert.doesNotMatch(code, re, String(re));
  }
});

test("Emergency Help opens in a dedicated page that exists, from both the popup and the dashboard", () => {
  assert.ok(fs.existsSync(path.join(root, "src/emergency/emergency.html")));
  const popup = read("src/popup/popup.html");
  assert.match(popup, /id="open-emergency"[^>]*>\s*<span data-i18n="emergency_btn">Emergency Help<\/span>/);
  assert.match(popup, /aria-describedby="emergency-desc"/);
  assert.match(read("src/popup/popup.js"), /src\/emergency\/emergency\.html/);
  const dash = read("src/dashboard/dashboard.html");
  assert.match(dash, /href="\.\.\/emergency\/emergency\.html"[^>]*>\s*<span data-i18n="emergency_btn">Emergency Help<\/span>/);
  // not hidden in Elder or normal mode
  assert.doesNotMatch(popup.match(/<button[^>]*id="open-emergency"[^>]*>/)[0], /elder-only/);
  assert.doesNotMatch(dash.match(/<a[^>]*emergency\.html"[^>]*>/)[0], /elder-only/);
});

test("Step 9 adds no permission and no manifest entry", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
  assert.equal(manifest.host_permissions, undefined);
  assert.equal(manifest.web_accessible_resources, undefined);
  assert.match(manifest.content_security_policy.extension_pages, /connect-src 'none'/);
});

test("Elder Mode keeps the Emergency Help button large", () => {
  const css = read("src/shared/theme.css");
  assert.match(css, /html\[data-elder="true"\] \.btn \{[^}]*min-height: 56px/);
  assert.match(css, /\.btn-emergency/);
  const own = read("src/emergency/emergency.css");
  assert.match(own, /html\[data-elder="true"\] \.incident-list/);
  assert.doesNotMatch(strip(own), /@keyframes|animation\s*:|blink|flash|countdown/i);
});

// ------------------------------------------------------------------ Step 12: prepare your complaint
test("complaint helper: lists what to write down, warns never to include secrets, and has a plain template", () => {
  const C = E.COMPLAINT;
  assert.ok(Object.isFrozen(C) && Object.isFrozen(C.items) && Object.isFrozen(C.template));
  const items = C.items.join(" ");
  for (const re of [/date and the time/, /phone numbers, UPI IDs, website addresses/, /transaction or UTR reference/, /last four digits/, /screenshots/i, /already done/]) assert.match(items, re);
  assert.ok(C.elderItems.length < C.items.length && C.elderItems.join(" ").length < items.length, "the Elder Mode list is shorter");
  assert.match(C.never, /Never write your OTP, UPI PIN, passwords or full card number/);
  assert.ok(C.template.length >= 6 && C.template.every((l) => /^[A-Z][^:]+: \(.+\)$/.test(l)), "every template line is 'Label: (hint)'");
  assert.match(C.templateHelp, /does not fill it in, copy it or keep anything/);
});

test("complaint helper: no numbers except 1930, no addresses, no contact links, and it never asks for a secret", () => {
  const all = JSON.stringify(E.COMPLAINT);
  assert.doesNotMatch(all, /https?:\/\/|\bwww\./i);
  assert.doesNotMatch(all, /\d/, "no digits at all in the complaint helper");
  assert.doesNotMatch(all, /tel:|sms:|mailto:|whatsapp|intent:/i);
  for (const line of [...E.COMPLAINT.items, ...E.COMPLAINT.elderItems, ...E.COMPLAINT.template]) {
    assert.doesNotMatch(line, /\b(OTP|PIN|password|CVV)\b/i, "only the warning line may mention secrets: " + line);
  }
});

test("complaint helper on the page: read-only text in both Emergency Help pages, no boxes, no extra clipboard use", () => {
  for (const file of [["src", "emergency", "emergency.html"], ["web", "app", "emergency.html"]]) {
    const html = fs.readFileSync(path.join(__dirname, "..", ...file), "utf8");
    const card = html.slice(html.indexOf('id="complaint-card"'), html.indexOf('id="trust-card"'));
    for (const id of ["complaint-h", "complaint-intro", "complaint-list", "complaint-never", "complaint-template", "complaint-help"]) assert.match(card, new RegExp('id="' + id + '"'), file.join("/") + " #" + id);
    assert.match(card, /<pre class="complaint-template" id="complaint-template" tabindex="0"/);
    assert.doesNotMatch(card, /<(input|textarea|select|form|button)\b|contenteditable/i);
    assert.ok(html.indexOf('id="report-card"') < html.indexOf('id="complaint-card"'), "it follows the reporting card");
  }
  const page = fs.readFileSync(path.join(__dirname, "..", "src", "emergency", "emergency.js"), "utf8");
  assert.equal((page.match(/navigator\.clipboard/g) || []).length, 1, "the helpline copy stays the only clipboard use");
  assert.match(page, /\$\("complaint-template"\)\.textContent = C\.template\.join\("\\n"\)/);
});

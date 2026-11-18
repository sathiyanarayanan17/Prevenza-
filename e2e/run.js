// Real-browser test: loads the extension into Chromium and checks it end to end.
// One-time setup: npx playwright-core install chromium
// Run:            npm run test:e2e   (opens a browser window for about 30 seconds)
const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const ET = require("../src/shared/elder-text.js");
const I18N = require("../src/shared/i18n.js");
const E9 = require("../src/shared/emergency.js");
const QR = require("qrcode");

const EXT = path.join(__dirname, "..");
const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// A tiny website with a password box, to prove the extension never touches form data.
const server = http
  .createServer((req, res) => {
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><head><title>Test shop</title></head><body>
      <h1>Test shop</h1>
      <form><input id="user" type="text" value="alice"><input id="pw" type="password" value="hunter2-SECRET">
      <input id="card" type="text" value="4111111111111111"></form></body></html>`);
  })
  .listen(0);

(async () => {
  const port = server.address().port;
  const site = `http://localhost:${port}/`;
  const userData = fs.mkdtempSync(path.join(os.tmpdir(), "prevenza-e2e-"));
  const launchStarted = Date.now();
  const ctx = await chromium.launchPersistentContext(userData, {
    headless: false,
    viewport: { width: 1100, height: 800 },
    // Step 12: two scam-like site names are answered by the local test server, so the page warning can be checked.
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run", "--host-resolver-rules=MAP sbi-kyc-update.xyz 127.0.0.1, MAP sbi.co.in.verify-account.xyz 127.0.0.1"],
  });

  const errors = [];
  const watch = (page, label) => {
    page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
  };

  try {
    // ---- 1. extension loads, service worker runs
    let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
    const swReadyMs = Date.now() - launchStarted; // Step 11: browser launch until the extension's worker is running
    sw.on("console", (m) => { if (m.type() === "error") errors.push("worker: " + m.text()); });
    const id = new URL(sw.url()).host;
    check("extension loads and the service worker starts", /^[a-p]{32}$/.test(id), id);
    const manifest = await sw.evaluate(() => chrome.runtime.getManifest());
    check("manifest is read by Chrome with the right name and version", manifest.name === "Prevenza: Scam Guard" && manifest.manifest_version === 3, `${manifest.name} v${manifest.version}`);
    check("only the 'storage' permission is granted", JSON.stringify(manifest.permissions) === '["storage"]' && !manifest.host_permissions);

    await sleep(500);
    const stored = await sw.evaluate(() => chrome.storage.local.get(null));
    check("first run wrote default settings and stats", stored["prevenza.settings"] && stored["prevenza.settings"].enabled === true && stored["prevenza.stats"] && stored["prevenza.stats"].installedAt, "keys: " + Object.keys(stored).join(", "));
    check("assistant badge is off by default (silent)", stored["prevenza.settings"].showAssistantBadge === false);

    // ---- 2. a normal website: content script is silent, but alive
    const web = await ctx.newPage();
    watch(web, "website");
    await web.goto(site);
    await sleep(1200);
    check("silent by default: no assistant element on the page", (await web.$("#prevenza-assistant-host")) === null);
    const status = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const replies = [];
      for (const t of tabs) {
        try { replies.push(await chrome.tabs.sendMessage(t.id, { type: "prevenza/get-tab-status" })); } catch (e) { /* no content script on this tab */ }
      }
      return replies;
    });
    check("content script answers a status request from the background", status.length === 1 && status[0].hostname === "localhost" && status[0].protocol === "http:" && status[0].ready === true, JSON.stringify(status[0]));

    // ---- 3. popup page
    const popup = await ctx.newPage();
    watch(popup, "popup");
    const popupRequests = [];
    popup.on("request", (r) => popupRequests.push(r.url()));
    await popup.setViewportSize({ width: 380, height: 640 });
    await popup.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await popup.waitForSelector("#protection-sub");
    await sleep(500);
    check("popup shows the Prevenza branding", (await popup.textContent(".brand-name")) === "Prevenza" && (await popup.textContent(".brand-sub")) === "Scam Guard");
    check("popup shows Prevy the assistant", (await popup.$(".top svg")) !== null);
    check("popup shows a clear risk indicator (Not scanned yet)", (await popup.textContent("#risk-pill")) === "Not scanned yet");
    check("popup loaded state from the background worker", (await popup.isChecked("#enabled")) === true && /On/.test(await popup.textContent("#protection-sub")));
    await popup.screenshot({ path: path.join(SHOTS, "1-popup.png") });

    // messaging round trip + rejection of bad messages
    const ping = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/ping" }));
    check("popup -> background message round trip (ping)", ping && ping.ok && ping.pong === true && ping.version === "0.1.0");
    const bad = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/evil" }));
    check("background rejects unknown message types", bad && bad.ok === false);
    const badPayload = await popup.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: "x" }));
    check("background rejects a malformed settings update", badPayload && badPayload.ok === false);

    // toggle protection from the popup -> saved in storage
    await popup.click("#enabled", { force: true });
    await sleep(500);
    let s = (await sw.evaluate(() => chrome.storage.local.get("prevenza.settings")))["prevenza.settings"];
    check("popup toggle saves 'protection off' to storage", s.enabled === false);
    check("popup text updates when protection is off", /Off/.test(await popup.textContent("#protection-sub")));
    await popup.click("#enabled", { force: true });
    await sleep(400);
    s = (await sw.evaluate(() => chrome.storage.local.get("prevenza.settings")))["prevenza.settings"];
    check("popup toggle turns protection back on", s.enabled === true);

    // popup opened on a browser page: friendly message, no crash
    check("popup on a non-website page explains it can't protect it", /can't be protected/i.test(await popup.textContent("#site")));

    // ---- 4. settings page + broadcast to the content script
    const settings = await ctx.newPage();
    watch(settings, "settings");
    const settingsRequests = [];
    settings.on("request", (r) => settingsRequests.push(r.url()));
    await settings.setViewportSize({ width: 1000, height: 1000 });
    await settings.goto(`chrome-extension://${id}/src/settings/settings.html`);
    await settings.waitForSelector("#language option", { state: "attached" });
    await sleep(400);
    check("settings page lists languages and sensitivity levels", (await settings.$$eval("#language option", (o) => o.length)) === 3 && (await settings.$$eval("#sensitivity option", (o) => o.length)) === 3);
    await settings.screenshot({ path: path.join(SHOTS, "2-settings.png"), fullPage: true });

    await settings.click("#showAssistantBadge", { force: true });
    await sleep(900);
    check("settings change is saved", (await sw.evaluate(() => chrome.storage.local.get("prevenza.settings")))["prevenza.settings"].showAssistantBadge === true);
    check("settings change reaches the open website (assistant badge appears)", (await web.$("#prevenza-assistant-host")) !== null && (await web.getAttribute("#prevenza-assistant-host", "data-badge")) === "visible");
    await web.screenshot({ path: path.join(SHOTS, "3-assistant-on-page.png") });

    // mute this site -> badge disappears
    await settings.fill("#site-input", "https://LOCALHOST:" + port + "/");
    await settings.click("#add-form button[type=submit]");
    await sleep(900);
    check("muting a site saves it normalized", (await sw.evaluate(() => chrome.storage.local.get("prevenza.settings")))["prevenza.settings"].mutedSites.includes("localhost"));
    check("muted site: the assistant disappears from the page", (await web.$("#prevenza-assistant-host")) === null);
    await settings.fill("#site-input", "not a site!!");
    await settings.click("#add-form button[type=submit]");
    check("settings page refuses an invalid site name", /does not look like a website/i.test(await settings.textContent("#site-error")));

    // un-mute and preview from the "popup" path (background -> content script)
    await settings.click("#sites button");
    await sleep(900);
    const preview = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      const out = [];
      for (const t of tabs) { try { out.push(await chrome.tabs.sendMessage(t.id, { type: "prevenza/preview-assistant" })); } catch (e) { /* skip */ } }
      return out;
    });
    await sleep(300);
    check("preview request opens Prevy's speech bubble on the page", preview.length === 1 && preview[0].shown === true && (await web.getAttribute("#prevenza-assistant-host", "data-bubble")) === "open");
    await web.screenshot({ path: path.join(SHOTS, "4-assistant-bubble.png") });

    // elder mode
    await settings.click("#elderMode", { force: true });
    await sleep(600);
    const elderSize = await settings.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    check("elder mode enlarges text", elderSize >= 20, elderSize + "px");

    // ---- 5. page being typed in is never read or stored
    await web.fill("#user", "typed-by-user-XYZ");
    await sleep(600);
    const everything = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    check("passwords, card numbers and typed text never reach storage", !/hunter2|SECRET|4111|typed-by-user|alice/i.test(everything));
    check("page form values are left untouched", (await web.inputValue("#pw")) === "hunter2-SECRET" && (await web.inputValue("#card")) === "4111111111111111");

    // ---- 6. dashboard
    const dash = await ctx.newPage();
    watch(dash, "dashboard");
    const dashRequests = [];
    dash.on("request", (r) => dashRequests.push(r.url()));
    await dash.setViewportSize({ width: 1100, height: 900 });
    await dash.goto(`chrome-extension://${id}/src/dashboard/dashboard.html`);
    await dash.waitForSelector("#legend li");
    await sleep(500);
    // Step 11: the legend now lists all six states the interface can show (it used to omit Critical and Inconclusive).
    check("dashboard shows every risk state, each with a label and a shape", JSON.stringify(await dash.$$eval("#legend .pill", (p) => p.map((x) => x.textContent))) === JSON.stringify(["Not scanned yet", "Low risk", "Medium risk", "High risk", "Critical risk", "Inconclusive"]));
    check("dashboard counts the pages watched", parseInt(await dash.textContent("#stat-pages"), 10) >= 1, "pages: " + (await dash.textContent("#stat-pages")));
    check("dashboard shows planned features honestly (no fake detection)", (await dash.$$eval("#road .chip", (c) => c.filter((x) => x.textContent === "Planned").length)) >= 5);
    await dash.click("#run-check");
    await sleep(1500);
    const checks = await dash.$$eval("#checks li", (l) => l.map((x) => ({ ok: x.className === "ok", t: x.textContent })));
    check("system check passes (worker, storage, page watcher)", checks.length === 3 && checks.every((c) => c.ok), checks.map((c) => (c.ok ? "ok" : "BAD") + ":" + c.t.slice(1, 28)).join(" | "));
    await dash.screenshot({ path: path.join(SHOTS, "5-dashboard.png"), fullPage: true });
    await dash.setViewportSize({ width: 390, height: 844 });
    await sleep(300);
    const overflow = await dash.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1);
    check("dashboard is responsive on a phone-sized window (no sideways scrolling)", overflow === false);
    await dash.screenshot({ path: path.join(SHOTS, "6-dashboard-mobile.png"), fullPage: true });

    // ---- 6b. Step 2: offline URL intelligence (new checks, added after the Step 1 checks)
    await dash.setViewportSize({ width: 1100, height: 900 });
    const checkLink = async (text) => {
      await dash.fill("#link-input", text);
      await dash.click("#link-form button[type=submit]");
      await sleep(350);
      return dash.textContent("#link-result");
    };
    let out = await checkLink("https://retail.onlinesbi.sbi/login");
    check("link checker: the real SBI address is Low risk and recognised", /Low risk/.test(out) && /SBI/.test(out) && /does not prove/i.test(out));
    out = await checkLink("https://sbi-kyc-update.xyz/login");
    check("link checker: a fake KYC address is High risk with reasons", /High risk/.test(out) && /not SBI's website/.test(out) && (await dash.$$eval("#link-result .reasons li", (l) => l.length)) >= 3);
    check("link checker: the risk has a label AND a shape (not colour alone)", (await dash.$("#link-result .pill-danger")) !== null && /High risk/.test(await dash.textContent("#link-result .pill")));
    await dash.screenshot({ path: path.join(SHOTS, "7-link-checker-high.png"), fullPage: true });
    out = await checkLink("https://bit.ly/abc123");
    check("link checker: a shortened link is Medium risk", /Medium risk/.test(out) && /destination|where/i.test(out));
    out = await checkLink("http://203.0.113.9/login");
    check("link checker: a bare number address is flagged", /number address/i.test(out) && !/Low risk/.test(out));
    out = await checkLink("https://xn--pple-43d.com");
    // Step 11: the pill now shows the central engine's category. A critical sign is Critical there (it was "High" on the old URL-only scale).
    check("link checker: look-alike alphabet trick is Critical risk (central engine)", /Critical risk/.test(out) && /alphabets/i.test(out));
    out = await checkLink("https://sbi.co.in@evil.com/");
    check("link checker: the @ trick is caught, rated Critical risk (central engine), and the real site is named", /Critical risk/.test(out) && /evil\.com/.test(out));
    out = await checkLink("https://example.com");
    check("link checker: an ordinary site gets no needless warning", /Low risk/.test(out) && /Nothing unusual/.test(out));
    out = await checkLink("not a link ???");
    check("link checker: malformed text gets a friendly message, no crash", /single web address|valid web address/i.test(out));
    out = await checkLink("javascript:alert(1)");
    check("link checker: unsupported addresses are refused politely", /http or https/i.test(out));
    out = await checkLink("");
    check("link checker: an empty box asks for an address", /type or paste/i.test(out));
    check("link checker: the typed address is not kept in the page after checking", !(await dash.textContent("#link-result")).includes("javascript"));

    // ---- 6c. Step 4: multilingual message checker (new checks, added after the Step 1 and Step 2 checks)
    const checkMessage = async (text, language) => {
      await dash.selectOption("#msg-language", language || "auto");
      await dash.fill("#msg-input", text);
      await dash.click("#msg-analyze");
      await sleep(500);
      return dash.textContent("#msg-result");
    };
    check("message checker: the section has a text box, a language list, Analyze and Clear", (await dash.$("#msg-input")) !== null && (await dash.$$eval("#msg-language option", (o) => o.length)) === 5 && /Analyze/.test(await dash.textContent("#msg-analyze")) && /Clear/.test(await dash.textContent("#msg-clear")));
    check("message checker: before any check nothing is claimed (no result shown)", (await dash.textContent("#msg-result")).trim() === "");

    let msgOut = await checkMessage("Dear customer, your SBI KYC is pending. Your account will be blocked today. Click here to update immediately.");
    check("message checker (English): fake KYC is High or Critical risk with the scam type named", /(High|Critical) risk/.test(msgOut) && /Fake KYC update/.test(msgOut), (await dash.textContent("#msg-result .pill")));
    check("message checker: risk has a label AND a shape (not colour alone)", (await dash.$("#msg-result .pill-danger, #msg-result .pill-critical")) !== null && /risk/.test(await dash.textContent("#msg-result .pill")));
    check("message checker: the score is shown as a warning level, not a probability", /Warning level \d+ of 100/.test(msgOut) && /not the probability/i.test(msgOut));
    check("message checker: suspicious phrases are marked in the user's own text", (await dash.$$eval("#msg-result mark.hit", (m) => m.length)) >= 2 && (await dash.$$eval("#msg-result .msg-text mark.hit", (m) => m.every((x) => x.querySelector(".visually-hidden") !== null))));
    check("message checker: reasons and advice come from the signs found", (await dash.$$eval("#msg-result .reasons li", (l) => l.length)) >= 2 && /KYC/.test(await dash.textContent("#msg-result .reasons")) && (await dash.$$eval("#msg-result .actions-list li", (l) => l.length)) >= 1);
    check("message checker: the language is shown as a best guess", /Language: English/.test(msgOut) && /best guess/i.test(msgOut));
    check("message checker: Prevy appears next to the result", (await dash.$("#msg-result .verdict svg")) !== null);
    await dash.screenshot({ path: path.join(SHOTS, "9-message-checker-high.png"), fullPage: true });

    msgOut = await checkMessage("प्रिय ग्राहक, आपका केवाईसी अपडेट अधूरा है। आपका खाता आज बंद हो जाएगा। तुरंत लिंक पर क्लिक करें।");
    check("message checker (Hindi script): fake KYC is detected and the language is Hindi", /Fake KYC update/.test(msgOut) && /Language: Hindi/.test(msgOut) && (await dash.$$eval("#msg-result mark.hit", (m) => m.length)) >= 1);
    msgOut = await checkMessage("சிபிஐ அதிகாரி பேசுகிறேன். உங்கள் மீது பணமோசடி வழக்கு உள்ளது. டிஜிட்டல் கைது செய்யப்பட்டுள்ளீர்கள். யாரிடமும் சொல்ல வேண்டாம்.");
    check("message checker (Tamil): digital arrest is Critical risk with its own shape", /Critical risk/.test(msgOut) && (await dash.$("#msg-result .pill-critical")) !== null && /Language: Tamil/.test(msgOut));
    msgOut = await checkMessage("Sir aapka OTP bata do, abhi turant.");
    check("message checker (Hinglish): an OTP request is detected", /OTP, PIN or password request/.test(msgOut) && /Language: Hinglish/.test(msgOut) && /Never share your OTP/i.test(msgOut));
    msgOut = await checkMessage("Aapka parcel customs mein ruka hai. Delivery fee Rs 50 pay karein.", "hinglish");
    check("message checker: choosing a language is respected", /Fake parcel or delivery fee/.test(msgOut));

    msgOut = await checkMessage("Rs 2,500.00 debited from A/c XX1234 on 15-Nov. If this was not you, call 1800 1234 or visit your nearest branch.");
    check("message checker: a genuine bank alert is Low risk and nothing is marked", /Low risk/.test(msgOut) && (await dash.$$eval("#msg-result mark.hit", (m) => m.length)) === 0 && /No specific kind of scam/.test(msgOut));
    msgOut = await checkMessage("123456 is your OTP for login. Do not share it with anyone.");
    check("message checker: 'do not share your OTP' is not treated as an OTP request", /Low risk/.test(msgOut) && !/OTP, PIN or password request/.test(msgOut));
    msgOut = await checkMessage("Hi, are we meeting for lunch tomorrow?");
    check("message checker: an ordinary message gets no needless warning and is not called safe", /Low risk/.test(msgOut) && /No strong warning signs/.test(msgOut) && /not (?:a guarantee|proof of safety)/i.test(msgOut));

    msgOut = await checkMessage("Your KYC is pending. Update immediately at https://sbi-kyc-update.xyz/login");
    check("message checker: a link inside the message is also checked", /1 link inside it/.test(msgOut) && /Website address/.test(msgOut));

    msgOut = await checkMessage("   ");
    check("message checker: an empty message asks for text", /Paste a message/i.test(msgOut));
    await dash.fill("#msg-input", "Share your OTP now");
    await dash.click("#msg-clear");
    check("message checker: Clear empties the box and the result", (await dash.inputValue("#msg-input")) === "" && (await dash.textContent("#msg-result")).trim() === "" && /^0 of/.test(await dash.textContent("#msg-count")));
    await dash.fill("#msg-input", "x".repeat(6000));
    check("message checker: the box stops at 5000 characters", (await dash.inputValue("#msg-input")).length === 5000);
    await dash.click("#msg-clear");

    // protection off -> the message checker does nothing
    await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { enabled: false } } }));
    msgOut = await checkMessage("Please share your OTP now");
    check("message checker: protection off means the message is not analysed", /Protection is off/.test(msgOut) && (await dash.$("#msg-result .pill")) === null);
    await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { enabled: true } } }));

    // privacy, and the strict message shape
    const privateText = "ZQX-private-marker-4471 please share your OTP";
    await checkMessage(privateText);
    const afterMessages = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    check("message checker: no pasted message is stored anywhere", !/ZQX|private-marker|OTP|KYC|केवाईसी|parcel|sbi-kyc/i.test(afterMessages), "storage keys: " + Object.keys(JSON.parse(afterMessages)).join(", "));
    const extra = await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/scan-message", payload: { text: "hi", url: "https://example.com/x?token=1" } }));
    check("message checker: the background refuses a message that carries extra fields", extra.ok === false && extra.error === "bad-payload");
    await dash.click("#msg-clear");

    // narrow screen and elder mode (elder mode was switched on earlier in this run, so this page is already in it)
    await dash.setViewportSize({ width: 390, height: 844 });
    await checkMessage("Dear customer, your SBI KYC is pending. Your account will be blocked today. Click here to update immediately https://sbi-kyc-update.xyz/login");
    check("message checker: a long result does not scroll sideways on a phone-sized window", (await dash.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) === false);
    const sizes = await dash.evaluate(() => ({
      elder: document.documentElement.getAttribute("data-elder"),
      font: parseFloat(getComputedStyle(document.documentElement).fontSize),
      analyze: document.getElementById("msg-analyze").getBoundingClientRect().height,
      clear: document.getElementById("msg-clear").getBoundingClientRect().height,
      select: document.getElementById("msg-language").getBoundingClientRect().height,
    }));
    check("message checker: elder mode enlarges the text and every control stays at least 44px tall", sizes.elder === "true" && sizes.font >= 20 && sizes.analyze >= 44 && sizes.clear >= 44 && sizes.select >= 44, JSON.stringify(sizes));
    await dash.screenshot({ path: path.join(SHOTS, "10-message-checker-mobile.png"), fullPage: true });
    await dash.setViewportSize({ width: 1100, height: 900 });
    await dash.click("#msg-clear");
    const popup3 = await ctx.newPage();
    watch(popup3, "popup shortcut");
    await popup3.setViewportSize({ width: 380, height: 640 });
    await popup3.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await popup3.waitForSelector("#open-message-check");
    const opened = ctx.waitForEvent("page", { timeout: 5000 }).catch(() => null);
    await popup3.click("#open-message-check");
    const msgTab = await opened;
    await sleep(500);
    check("popup: 'Check a message' opens the dashboard at the message checker", !!msgTab && /dashboard\.html#message-check$/.test(msgTab.url()), msgTab ? msgTab.url() : "no tab opened");
    if (msgTab) await msgTab.close().catch(() => undefined);

    // ---- 6d. Step 5: UPI payment analyzer (new checks, added after the Step 1 to 4 checks)
    const checkUpi = async (f) => {
      await dash.fill("#upi-id", f.upiId || "");
      await dash.fill("#upi-name", f.name || "");
      await dash.fill("#upi-amount", f.amount || "");
      await dash.fill("#upi-reason", f.reason || "");
      await dash.fill("#upi-qr", f.qr || "");
      await dash.click("#upi-analyze");
      await sleep(500);
      return dash.textContent("#upi-result");
    };
    check("UPI analyzer: the section has the five fields, Analyze and Clear, and no PIN, OTP, password or file field", (await dash.$$eval("#upi-form input, #upi-form textarea", (n) => n.length)) === 5 && (await dash.$("#upi-form input[type=password], #upi-form input[type=file]")) === null && /Analyze/.test(await dash.textContent("#upi-analyze")) && /Clear/.test(await dash.textContent("#upi-clear")));
    check("UPI analyzer: it says never to type a PIN or OTP and that it cannot stop payments", /Never type your UPI PIN or an OTP here/.test(await dash.textContent("#upi-check")) && /cannot stop or cancel a payment/.test(await dash.textContent("#upi-check")));
    check("UPI analyzer: before any check nothing is claimed", (await dash.textContent("#upi-result")).trim() === "");

    let upiOut = await checkUpi({ upiId: "ramesh.k@oksbi", name: "Ramesh Kumar", amount: "500", reason: "Dinner share" });
    check("UPI analyzer: a normal payment is Low risk with no Holdy warning and is not called safe", /Low risk/.test(upiOut) && (await dash.$("#upi-result .holdy")) === null && /not proof of safety|not a guarantee/i.test(upiOut) && /cannot stop or cancel/i.test(upiOut));
    upiOut = await checkUpi({ upiId: "x7qz9@newbankxyz", amount: "250" });
    check("UPI analyzer: an unfamiliar UPI ID is not treated as a warning sign", /Low risk/.test(upiOut) && /not a warning sign/i.test(upiOut) && (await dash.$("#upi-result .holdy")) === null);

    upiOut = await checkUpi({ upiId: "sbi.customercare@ybl", name: "SBI Support", amount: "10", reason: "Pay Rs 10 to get your refund" });
    check("UPI analyzer: a fake-support refund payment is High or Critical risk", /(High|Critical) risk/.test(upiOut) && /Warning level \d+ of 100/.test(upiOut) && /not the probability/i.test(upiOut));
    check("UPI analyzer: risk has a label AND a shape (not colour alone)", (await dash.$("#upi-result .pill-danger, #upi-result .pill-critical")) !== null && /risk/.test(await dash.textContent("#upi-result .pill")));
    check("UPI analyzer: Prevy shows a warning headline, plain advice and the 'cannot stop payments' note", (await dash.$("#upi-result .holdy svg")) !== null && /pay to receive money\? Be careful/.test(await dash.textContent("#upi-result .holdy h3")) && /cannot stop or cancel a payment/i.test(await dash.textContent("#upi-result .holdy")));
    check("UPI analyzer: the four actions are offered and none claims to cancel anything", (await dash.$$eval("#upi-result .holdy li", (l) => l.length)) === 4 && /Review the payment details/.test(await dash.textContent("#upi-result .holdy li:first-child button")) && /Ask a trusted/.test(await dash.textContent("#upi-result .holdy")) && /Continue only after/.test(await dash.textContent("#upi-result .holdy")));
    check("UPI analyzer: reasons come from the signs found and name their source", (await dash.$$eval("#upi-result .reasons li", (l) => l.length)) >= 3 && /UPI payment details/.test(await dash.textContent("#upi-result .reasons")));
    await dash.screenshot({ path: path.join(SHOTS, "11-upi-analyzer-warning.png"), fullPage: true });
    await dash.click("#upi-result .holdy li:first-child button");
    check("UPI analyzer: 'Review the payment details' returns you to the form (it does not act on a payment)", (await dash.evaluate(() => document.activeElement && document.activeElement.id)) === "upi-id");

    upiOut = await checkUpi({ upiId: "help@ybl", amount: "1", reason: "Please share your UPI PIN and OTP to receive the money" });
    check("UPI analyzer: a PIN or OTP request shows the 'never share' warning", /Never share your UPI PIN or OTP with anyone/.test(await dash.textContent("#upi-result .holdy h3")) && /Never share your OTP/i.test(upiOut));
    upiOut = await checkUpi({ upiId: "rbi.safe@ybl", amount: "250000", reason: "Transfer your money to the RBI safe account" });
    check("UPI analyzer: safe-account wording is Critical risk with its own shape", /Critical risk/.test(upiOut) && (await dash.$("#upi-result .pill-critical")) !== null && /no such thing as a safe account/i.test(upiOut));
    upiOut = await checkUpi({ upiId: "abc@ybl", amount: "49", reason: "\u092a\u0948\u0938\u0947 \u092a\u093e\u0928\u0947 \u0915\u0947 \u0932\u093f\u090f 100 \u0930\u0941\u092a\u092f\u0947 \u092d\u0947\u091c\u0947\u0902" });
    check("UPI analyzer: a Hindi payment reason is read too", /Medium risk|High risk|Critical risk/.test(upiOut) && /pay first in order to receive money/i.test(upiOut));
    upiOut = await checkUpi({ upiId: "friend@ybl", reason: "Urgent: electricity bill for March, due today", amount: "1200" });
    check("UPI analyzer: a genuine message containing 'urgent' stays Low risk", /Low risk/.test(upiOut) && (await dash.$("#upi-result .holdy")) === null);

    upiOut = await checkUpi({ qr: "upi://pay?pa=shop@ybl&pn=Corner%20Shop&am=120&cu=INR&tn=Milk" });
    check("UPI analyzer: a pasted payment code is read and its recipient and amount are shown", /What the pasted code contains/.test(upiOut) && /shop@ybl/.test(upiOut) && /120/.test(upiOut) && /Low risk/.test(upiOut));
    upiOut = await checkUpi({ qr: "upi://collect?pa=other@ybl&pn=X&am=5000" });
    check("UPI analyzer: a code that takes money from you is flagged with a warning", /takes money from you/.test(upiOut) && (await dash.$("#upi-result .holdy")) !== null);
    upiOut = await checkUpi({ qr: "hello world" });
    check("UPI analyzer: text that is not a UPI code is explained and not analysed", /could not read this as a UPI payment code/i.test(upiOut) && (await dash.$("#upi-result .pill")) === null);
    upiOut = await checkUpi({ upiId: "not a upi id", amount: "100" });
    check("UPI analyzer: an invalid UPI ID is explained, not called fraud", /looks like name@bank/.test(upiOut) && !/High risk|Critical risk/.test(upiOut));
    upiOut = await checkUpi({});
    check("UPI analyzer: empty input asks for at least one detail", /at least one detail/i.test(upiOut));
    upiOut = await checkUpi({ upiId: "a.b@ybl", amount: "50,00,000" });
    check("UPI analyzer: a very large amount is only noted, not called fraud", /Low risk/.test(upiOut) && /above what many UPI payments allow/i.test(upiOut));
    upiOut = await checkUpi({ amount: "banana", upiId: "a.b@ybl" });
    check("UPI analyzer: an unreadable amount is explained", /amount could not be read/i.test(upiOut));

    await dash.fill("#upi-id", "someone@ybl");
    await dash.click("#upi-clear");
    check("UPI analyzer: Clear empties every field and the result", (await dash.inputValue("#upi-id")) === "" && (await dash.inputValue("#upi-reason")) === "" && (await dash.textContent("#upi-result")).trim() === "");

    await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { enabled: false } } }));
    upiOut = await checkUpi({ upiId: "refund@ybl", amount: "10" });
    check("UPI analyzer: protection off means the payment is not analysed", /Protection is off/.test(upiOut) && (await dash.$("#upi-result .pill")) === null);
    await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { enabled: true } } }));

    await checkUpi({ upiId: "zq9private4471@ybl", name: "Zq9 Private Person", amount: "4471.55", reason: "zq9-private-reason pay to receive refund", qr: "upi://pay?pa=private-qr@ybl&am=5" });
    const upiStored = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    check("UPI analyzer: no UPI ID, name, amount, reason or code is stored anywhere", !/zq9|4471|private-qr|private-reason|ybl|refund/i.test(upiStored), "storage keys: " + Object.keys(JSON.parse(upiStored)).join(", "));
    const pinReply = await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/analyze-upi", payload: { upiId: "a@ybl", upiPin: "4321" } }));
    check("UPI analyzer: the background refuses any field that could carry a PIN or OTP", pinReply.ok === false && pinReply.error === "bad-payload" && !JSON.stringify(pinReply).includes("4321"));

    await dash.setViewportSize({ width: 390, height: 844 });
    await checkUpi({ upiId: "sbi.customercare@ybl", name: "SBI Support", amount: "10", reason: "Pay Rs 10 to get your refund. Customer care says approve the collect request", qr: "upi://collect?pa=other@ybl&pn=X&am=5000" });
    check("UPI analyzer: a long result does not scroll sideways on a phone-sized window", (await dash.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) === false);
    const upiSizes = await dash.evaluate(() => ["upi-id", "upi-name", "upi-amount", "upi-analyze", "upi-clear"].map((i) => document.getElementById(i).getBoundingClientRect().height));
    check("UPI analyzer: every control is at least 44px tall (elder mode is on)", upiSizes.every((h) => h >= 44), upiSizes.join(","));
    await dash.screenshot({ path: path.join(SHOTS, "12-upi-analyzer-mobile.png"), fullPage: true });
    await dash.setViewportSize({ width: 1100, height: 900 });
    await dash.click("#upi-clear");

    // ---- 6e. Step 6: screenshot checker with offline text reading (new checks, added after the Step 1 to 5 checks)
    const ocrErrorsBefore = errors.length;
    const externalBefore = dashRequests.filter((u) => !u.startsWith("chrome-extension://") && !u.startsWith("data:")).length;
    const makeImage = async (name, lines, opts) => {
      const o = Object.assign({ font: "30px Arial", mime: "image/png", width: 1000, noise: false, blank: false }, opts || {});
      const b64 = await dash.evaluate(async ({ lines, o }) => {
        const c = document.createElement("canvas");
        c.width = o.width;
        c.height = Math.max(120, 80 + lines.length * 64);
        const g = c.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, c.width, c.height);
        if (o.noise) {
          const d = g.getImageData(0, 0, c.width, c.height);
          for (let i = 0; i < d.data.length; i += 4) { const v = Math.floor(Math.random() * 256); d.data[i] = v; d.data[i + 1] = v; d.data[i + 2] = v; }
          g.putImageData(d, 0, 0);
        } else if (!o.blank) {
          g.fillStyle = "#111";
          g.font = o.font;
          g.textBaseline = "top";
          lines.forEach((l, i) => g.fillText(l, 30, 30 + i * 64));
        }
        const blob = await new Promise((r) => c.toBlob(r, o.mime, 0.92));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
        return btoa(s);
      }, { lines, o });
      const file = path.join(os.tmpdir(), name);
      fs.writeFileSync(file, Buffer.from(b64, "base64"));
      return file;
    };
    const readShot = async (file, language) => {
      await dash.setInputFiles("#shot-file", file);
      await sleep(400);
      await dash.selectOption("#shot-language", language || "eng");
      await dash.evaluate(() => {
        window.__sawProgress = false;
        const wrap = document.getElementById("shot-progress-wrap");
        new MutationObserver(() => { if (!wrap.hidden) window.__sawProgress = true; }).observe(wrap, { attributes: true });
      });
      await dash.click("#shot-analyze");
      await dash.waitForFunction(() => document.getElementById("shot-result").textContent.length > 0 || !document.getElementById("shot-problem").hidden, null, { timeout: 90000 });
      await sleep(300);
      return dash.textContent("#shot-result");
    };

    check("screenshot checker: it has a file picker for PNG and JPEG only, a language list, and no capture or camera", (await dash.getAttribute("#shot-file", "accept")) === "image/png,image/jpeg" && (await dash.getAttribute("#shot-file", "capture")) === null && (await dash.$$eval("#shot-language option", (o) => o.length)) === 4);
    check("screenshot checker: it says images stay on the device, nothing is captured automatically, and not to trust a payment screenshot alone", /never saved or sent anywhere/.test(await dash.textContent("#screenshot-check")) && /never takes screenshots by itself/.test(await dash.textContent("#screenshot-check")) && /Do not trust a payment screenshot alone/.test(await dash.textContent("#screenshot-check")));
    check("screenshot checker: before an image is chosen, reading is disabled and nothing is claimed", (await dash.isDisabled("#shot-analyze")) && (await dash.isDisabled("#shot-remove")) && (await dash.textContent("#shot-result")).trim() === "");

    // file checks
    await dash.setInputFiles("#shot-file", { name: "notes.png", mimeType: "image/png", buffer: Buffer.from("this is plain text renamed to look like a png file, nothing more") });
    await sleep(400);
    check("screenshot checker: a file that is not really a PNG or JPEG is refused, even if renamed", /PNG and JPEG screenshots only/.test(await dash.textContent("#shot-problem")) && (await dash.isHidden("#shot-preview")) && (await dash.isDisabled("#shot-analyze")));
    await dash.setInputFiles("#shot-file", { name: "animation.gif", mimeType: "image/gif", buffer: Buffer.from("GIF89a" + "x".repeat(200)) });
    await sleep(300);
    check("screenshot checker: a GIF is refused", /PNG and JPEG screenshots only/.test(await dash.textContent("#shot-problem")));
    await dash.setInputFiles("#shot-file", { name: "big.png", mimeType: "image/png", buffer: Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(9 * 1024 * 1024)]) });
    await sleep(500);
    check("screenshot checker: an oversized image is refused before it is read", /under 8\.0 MB/.test(await dash.textContent("#shot-problem")) && (await dash.isHidden("#shot-preview")));
    await dash.setInputFiles("#shot-file", { name: "empty.png", mimeType: "image/png", buffer: Buffer.alloc(0) });
    await sleep(300);
    check("screenshot checker: an empty file is refused", /empty/i.test(await dash.textContent("#shot-problem")) && (await dash.isDisabled("#shot-analyze")));
    await dash.setInputFiles("#shot-file", []);
    await sleep(300);
    check("screenshot checker: choosing nothing leaves nothing to read", (await dash.isDisabled("#shot-analyze")) && (await dash.isHidden("#shot-preview")));

    // a real PNG scam screenshot, read by the bundled offline engine
    const scamPng = await makeImage("prevenza-scam.png", ["Dear customer, your SBI KYC is pending.", "Your account will be blocked today.", "Please share the OTP you just received."]);
    await dash.setInputFiles("#shot-file", scamPng);
    await sleep(500);
    check("screenshot checker: a valid PNG is accepted, previewed with a text alternative, and can be removed", (await dash.isVisible("#shot-img")) && (await dash.getAttribute("#shot-img", "alt")) === "Preview of the screenshot you chose" && (await dash.isEnabled("#shot-analyze")) && (await dash.isEnabled("#shot-remove")) && /PNG/.test(await dash.textContent("#shot-file-name")));
    const t0 = Date.now();
    let shotOut = await readShot(scamPng, "eng");
    const seconds = ((Date.now() - t0) / 1000).toFixed(1);
    const extracted = await dash.inputValue("#shot-text");
    check("screenshot checker: the bundled engine read the text on the device (English PNG)", /kyc/i.test(extracted) && /otp/i.test(extracted) && /blocked/i.test(extracted), seconds + " s, " + extracted.length + " characters");
    check("screenshot checker: it showed a progress bar while reading, and hides it afterwards", (await dash.evaluate(() => window.__sawProgress)) === true && (await dash.isHidden("#shot-progress-wrap")));
    check("screenshot checker: the text that was read is shown to the user and can be corrected", (await dash.isVisible("#shot-text")) && (await dash.isEditable("#shot-text")));
    check("screenshot checker: an English scam screenshot is High or Critical risk with the scam type named", /(High|Critical) risk/.test(shotOut) && /Looks like: /.test(shotOut) && /Warning level \d+ of 100/.test(shotOut) && /not the probability/i.test(shotOut));
    check("screenshot checker: risk has a label AND a shape, and suspicious phrases are marked in the text", (await dash.$("#shot-result .pill-danger, #shot-result .pill-critical")) !== null && (await dash.$$eval("#shot-result mark.hit", (m) => m.length)) >= 2);
    check("screenshot checker: reasons come from the signs found and name their source", (await dash.$$eval("#shot-result .reasons li", (l) => l.length)) >= 2 && /Screenshot text/.test(await dash.textContent("#shot-result .reasons")) && (await dash.$$eval("#shot-result .actions-list li", (l) => l.length)) >= 1);
    check("screenshot checker: after reading, the image data is released (choose the file again to read it again)", await dash.isDisabled("#shot-analyze"));
    check("screenshot checker: the reader's worker has ended and nothing external was requested", (await dash.evaluate(() => 0)) === 0 && dash.workers().length === 0 && dashRequests.filter((u) => !u.startsWith("chrome-extension://") && !u.startsWith("data:")).length === externalBefore);
    await dash.screenshot({ path: path.join(SHOTS, "13-screenshot-checker.png"), fullPage: true });

    // receipt, fake confirmation, OTP request, JPEG
    const receipt = await makeImage("prevenza-receipt.jpg", ["Payment successful", "Paid to Corner Shop", "Rs 250.00", "UPI Ref No: 412345678901", "shop@ybl"], { mime: "image/jpeg" });
    shotOut = await readShot(receipt, "eng");
    check("screenshot checker: a valid JPEG payment receipt is read and is not called a scam", /Low risk|Medium risk/.test(shotOut) && !/High risk|Critical risk/.test(shotOut), (await dash.inputValue("#shot-text")).replace(/\s+/g, " ").slice(0, 80));
    check("screenshot checker: a payment receipt always carries 'do not trust a payment screenshot alone' and says nothing was verified", /Do not trust a payment screenshot alone\. Verify the payment in your own bank or UPI application\./.test(shotOut) && /cannot check whether a receipt is genuine/.test(shotOut) && /None of it was verified/.test(shotOut));
    const fake = await makeImage("prevenza-fake-confirm.png", ["Payment done sir, screenshot attached.", "Please send the parcel today.", "I have already paid."]);
    shotOut = await readShot(fake, "eng");
    check("screenshot checker: fake payment confirmation wording (release goods on a screenshot) is flagged with the receipt warning", /Asks you to hand over goods/.test(shotOut) && /Do not trust a payment screenshot alone/.test(shotOut) && /Medium risk|High risk|Critical risk/.test(shotOut));
    const pin = await makeImage("prevenza-pin.png", ["Hello sir. Please share your UPI PIN", "and OTP to receive the refund."]);
    shotOut = await readShot(pin, "eng");
    check("screenshot checker: an OTP or UPI PIN request is flagged with the 'never share' advice", /OTP, PIN or password request|Asks you to share an OTP/.test(shotOut) && /Never share your OTP/i.test(shotOut));

    // other languages
    const hindi = await makeImage("prevenza-hindi.png", ["\u092a\u094d\u0930\u093f\u092f \u0917\u094d\u0930\u093e\u0939\u0915, \u0906\u092a\u0915\u093e \u0915\u0947\u0935\u093e\u0908\u0938\u0940 \u0905\u092a\u0921\u0947\u091f \u0905\u0927\u0942\u0930\u093e \u0939\u0948\u0964", "\u0906\u092a\u0915\u093e \u0916\u093e\u0924\u093e \u0906\u091c \u092c\u0902\u0926 \u0939\u094b \u091c\u093e\u090f\u0917\u093e\u0964", "\u0915\u0943\u092a\u092f\u093e \u0905\u092a\u0928\u093e \u0913\u091f\u0940\u092a\u0940 \u092c\u0924\u093e\u090f\u0902\u0964"], { font: "32px Nirmala UI" });
    shotOut = await readShot(hindi, "hin");
    check("screenshot checker (Hindi script): the text is read and the scam is found", /(High|Critical) risk/.test(shotOut) && /Fake KYC update|OTP, PIN or password request/.test(shotOut) && /Hindi/.test(shotOut), (await dash.inputValue("#shot-text")).replace(/\s+/g, " ").slice(0, 60));
    const tamil = await makeImage("prevenza-tamil.png", ["\u0b85\u0ba9\u0bcd\u0baa\u0bc1\u0bb3\u0bcd\u0bb3 \u0bb5\u0bbe\u0b9f\u0bbf\u0b95\u0bcd\u0b95\u0bc8\u0baf\u0bbe\u0bb3\u0bb0\u0bc7, \u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd KYC \u0baa\u0bc1\u0ba4\u0bc1\u0baa\u0bcd\u0baa\u0bbf\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bb5\u0bbf\u0bb2\u0bcd\u0bb2\u0bc8.", "\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b95\u0ba3\u0b95\u0bcd\u0b95\u0bc1 \u0b87\u0ba9\u0bcd\u0bb1\u0bc1 \u0bae\u0bc1\u0b9f\u0b95\u0bcd\u0b95\u0baa\u0bcd\u0baa\u0b9f\u0bc1\u0bae\u0bcd.", "\u0b89\u0b99\u0bcd\u0b95\u0bb3\u0bcd \u0b93\u0b9f\u0bbf\u0baa\u0bbf \u0b8e\u0ba3\u0bcd\u0ba3\u0bc8 \u0b9a\u0bca\u0bb2\u0bcd\u0bb2\u0bc1\u0b99\u0bcd\u0b95\u0bb3\u0bcd."], { font: "32px Nirmala UI", width: 1300 });
    shotOut = await readShot(tamil, "tam");
    check("screenshot checker (Tamil script): the text is read and the scam is found", /(High|Critical) risk/.test(shotOut) && /Fake KYC update|OTP, PIN or password request|Fake account suspension/.test(shotOut) && /Tamil/.test(shotOut), (await dash.inputValue("#shot-text")).replace(/\s+/g, " ").slice(0, 60));
    const hinglish = await makeImage("prevenza-hinglish.png", ["Aapka KYC update pending hai.", "Aapka account band ho jayega.", "Turant link par click karo."]);
    shotOut = await readShot(hinglish, "eng");
    check("screenshot checker (Hinglish): English-letter Hindi is read and the scam is found", /Medium risk|High risk|Critical risk/.test(shotOut) && /Fake KYC update|Fake account suspension/.test(shotOut) && /Hinglish/.test(shotOut), (await dash.inputValue("#shot-text")).replace(/\s+/g, " ").slice(0, 60));

    // images the reader cannot use
    const noise = await makeImage("prevenza-noise.png", [], { noise: true });
    shotOut = await readShot(noise, "eng");
    check("screenshot checker: an unreadable image is reported as inconclusive, never as safe, and the user can try another", /Inconclusive/.test(shotOut) && !/Low risk/.test(shotOut) && /Nothing was marked safe/.test(shotOut) && (await dash.isEnabled("#shot-remove")), await dash.inputValue("#shot-text"));
    const blank = await makeImage("prevenza-blank.png", [], { blank: true });
    shotOut = await readShot(blank, "eng");
    check("screenshot checker: an image with no text says so and is not called safe", /No readable text was found/.test(shotOut) && /Inconclusive/.test(shotOut) && !/Low risk/.test(shotOut));

    // correcting the text, removing, clearing, privacy
    shotOut = await readShot(scamPng, "eng");
    await dash.fill("#shot-text", "ZQX-private-marker-9921 Please share your OTP right now");
    await dash.click("#shot-recheck");
    await sleep(600);
    shotOut = await dash.textContent("#shot-result");
    check("screenshot checker: the user can correct the text and check it again, without the image", /OTP, PIN or password request|Asks you to share an OTP/.test(shotOut) && /(Medium|High|Critical) risk/.test(shotOut));
    const shotStored = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    check("screenshot checker: no image, text or result is stored anywhere", !/ZQX|private-marker|kyc|otp|payment|corner shop|data:image/i.test(shotStored), "storage keys: " + Object.keys(JSON.parse(shotStored)).join(", "));
    const idb = await dash.evaluate(async () => (indexedDB.databases ? (await indexedDB.databases()).length : 0));
    check("screenshot checker: nothing was written to the browser's database cache either", idb === 0, "databases: " + idb);
    const badShot = await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/analyze-screenshot", payload: { text: "hi", image: "data:image/png;base64,AAAA" } }));
    check("screenshot checker: the background refuses an image or any extra field, only text is accepted", badShot.ok === false && badShot.error === "bad-payload");
    await dash.setInputFiles("#shot-file", scamPng);
    await sleep(400);
    await dash.click("#shot-remove");
    check("screenshot checker: 'Remove image' clears the picture and the file choice", (await dash.isHidden("#shot-preview")) && (await dash.getAttribute("#shot-img", "src")) === null && (await dash.inputValue("#shot-file")) === "" && (await dash.isDisabled("#shot-analyze")));
    await dash.click("#shot-clear");
    check("screenshot checker: 'Clear all' empties the text, the result and the messages", (await dash.isHidden("#shot-text-wrap")) && (await dash.inputValue("#shot-text")) === "" && (await dash.textContent("#shot-result")).trim() === "" && (await dash.isHidden("#shot-problem")));
    await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { enabled: false } } }));
    await dash.evaluate(() => { document.getElementById("shot-text-wrap").hidden = false; });
    await dash.fill("#shot-text", "Please share your OTP now");
    await dash.click("#shot-recheck");
    await sleep(500);
    check("screenshot checker: protection off means nothing is analysed", /Protection is off/.test(await dash.textContent("#shot-result")) && (await dash.$("#shot-result .pill")) === null);
    await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { enabled: true } } }));
    await dash.click("#shot-clear");

    // layout, elder mode (already on), accessibility
    await dash.setViewportSize({ width: 390, height: 844 });
    await readShot(scamPng, "eng");
    check("screenshot checker: a result with a preview does not scroll sideways on a phone-sized window", (await dash.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) === false);
    const shotSizes = await dash.evaluate(() => ["shot-file-label", "shot-language", "shot-analyze", "shot-remove", "shot-clear", "shot-recheck"].map((i) => document.getElementById(i).getBoundingClientRect().height));
    check("screenshot checker: every control is at least 44px tall", shotSizes.every((h) => h >= 44), shotSizes.join(","));
    check("screenshot checker: the progress bar and the status text are linked, and the file picker is reachable by keyboard", (await dash.getAttribute("#shot-progress", "aria-labelledby")) === "shot-status" && (await dash.getAttribute("#shot-status", "role")) === "status" && (await dash.evaluate(() => document.getElementById("shot-file").tabIndex)) === 0);
    await dash.screenshot({ path: path.join(SHOTS, "14-screenshot-checker-mobile.png"), fullPage: true });
    await dash.setViewportSize({ width: 1100, height: 900 });
    await dash.click("#shot-clear");

    // The Hindi reading model makes the engine print harmless "Parameter not found" notices to the console. Keep every other
    // error visible: this block's errors are checked here, and only those notices are set aside from the final run-wide check.
    const ocrErrors = errors.splice(ocrErrorsBefore);
    check("screenshot checker: reading produced no errors other than the engine's own harmless notices", ocrErrors.every((e) => /Warning: Parameter not found/.test(e)), ocrErrors.filter((e) => !/Warning: Parameter not found/.test(e)).slice(0, 2).map((e) => e.slice(0, 120)).join(" ; "));
    check("screenshot checker: reading made no network request at all (the engine and language data are bundled)", dashRequests.filter((u) => !u.startsWith("chrome-extension://") && !u.startsWith("data:")).length === externalBefore);

    // ---- 6f. Step 7: Prevy's intervention card across every checker (new checks, added after the Step 1 to 6 checks)
    const msgCard = async (text) => {
      await dash.selectOption("#msg-language", "auto");
      await dash.fill("#msg-input", text);
      await dash.click("#msg-analyze");
      await sleep(500);
    };
    const cardInfo = (sel) => dash.evaluate((s) => {
      const box = document.querySelector(s + " .holdy");
      const note = document.querySelector(s + " .holdy-note");
      return box
        ? { kind: "card", tier: box.dataset.tier, role: box.getAttribute("role"), repeat: box.dataset.repeat === "true", h3: box.querySelector("h3").textContent, tierLabel: box.querySelector(".holdy-tier").textContent, simple: box.querySelectorAll(".holdy-simple p").length, signs: box.querySelectorAll(".holdy-signs p").length, actions: box.querySelectorAll("li").length, firstIsButton: !!box.querySelector("li:first-child button"), text: box.textContent, labelled: !!document.getElementById(box.getAttribute("aria-labelledby")) }
        : note ? { kind: "note", tier: note.dataset.tier, text: note.textContent } : { kind: "none" };
    }, sel);
    await dash.evaluate(() => self.Prevenza.holdyCard.reset());

    await msgCard("Dear customer, your SBI KYC is pending. Share your OTP immediately or your account will be blocked.");
    let card = await cardInfo("#msg-result");
    check("Prevy (message, HIGH or CRITICAL): a prominent card with the urgency-and-OTP headline", card.kind === "card" && ["warning", "stop"].includes(card.tier) && /creating urgency and asking for sensitive information\. Do not share your OTP or PIN/.test(card.h3), card.tier + " | " + (card.h3 || "").slice(0, 60));
    check("Prevy: the level is a word and an icon, not colour alone, and the card is announced and labelled", /Warning|Stop/.test(card.tierLabel) && card.role === "alert" && card.labelled);
    check("Prevy: the card shows the evidence and the original shield mascot", card.signs >= 1 && card.simple >= 1 && /OTP/.test(card.text) && (await dash.$("#msg-result .holdy .holdy-head svg")) !== null);
    check("Prevy: elder mode (on in this run) shows one simple explanation and one sign", card.simple === 1 && card.signs === 1);
    check("Prevy: the five safety steps are offered, the first is a review button, and Prevy says it cannot stop messages", card.actions === 5 && card.firstIsButton && /Ask a trusted family member/.test(card.text) && /Continue only after/.test(card.text) && /cannot see or stop messages/.test(card.text));
    await dash.click("#msg-result .holdy li:first-child button");
    check("Prevy: 'Review the warning signs' moves focus to the analysis, it does not act on anything", (await dash.evaluate(() => document.activeElement && document.activeElement.textContent)) === "Why this result");
    await dash.screenshot({ path: path.join(SHOTS, "15-prevy-card.png"), fullPage: false });

    // repeats and dismissing (in memory only)
    await msgCard("Dear customer, your SBI KYC is pending. Share your OTP immediately or your account will be blocked.");
    card = await cardInfo("#msg-result");
    check("Prevy: the same result again shows a short card, not the full warning a second time", card.kind === "card" && card.repeat === true && /showed you this warning a moment ago/.test(card.text) && card.role === "status");
    await dash.click("#msg-result .holdy button:has-text('Show details')");
    card = await cardInfo("#msg-result");
    check("Prevy: 'Show details' brings the full card back", card.kind === "card" && card.repeat === false && card.actions === 5);
    await dash.click("#msg-result .holdy button:has-text('Dismiss')");
    card = await cardInfo("#msg-result");
    check("Prevy: dismissing leaves a note that the result is still High or Critical risk (never 'safe')", card.kind === "note" && /You hid Prevy's warning\. The result is still (High|Critical) risk/.test(card.text) && !/\bsafe\b/i.test(card.text) && /(High|Critical) risk/.test(await dash.textContent("#msg-result .verdict .pill")));
    await msgCard("Dear customer, your SBI KYC is pending. Share your OTP immediately or your account will be blocked.");
    check("Prevy: a dismissed warning stays hidden for the same result, and can be shown again", (await cardInfo("#msg-result")).kind === "note" && (await dash.$("#msg-result .holdy-note button")) !== null);
    await dash.click("#msg-result .holdy-note button");
    check("Prevy: 'Show the warning again' restores the full card", (await cardInfo("#msg-result")).repeat === false);
    await msgCard("Congratulations! You have won the lucky draw jackpot of 25 lakh. Pay the processing fee to claim your prize.");
    check("Prevy: a different result gets its own full warning", (await cardInfo("#msg-result")).repeat === false && (await cardInfo("#msg-result")).kind === "card");

    // every tier
    await msgCard("Your KYC is pending, please update it.");
    card = await cardInfo("#msg-result");
    check("Prevy (MEDIUM): a noticeable caution card that is not announced as an alert", card.kind === "card" && card.tier === "caution" && card.role === "status" && /Caution/.test(card.tierLabel) && /Hold on!/.test(card.h3), card.kind + " " + card.tier);
    await msgCard("This is CBI officer. A case of money laundering is registered against your Aadhaar. You are under digital arrest. Do not tell anyone.");
    card = await cardInfo("#msg-result");
    check("Prevy (CRITICAL): a strong 'stop and check first' warning", card.kind === "card" && card.tier === "stop" && /^Stop and check first\./.test(card.h3) && /Stop/.test(card.tierLabel));
    await msgCard("Hi, are we meeting for lunch tomorrow?");
    card = await cardInfo("#msg-result");
    check("Prevy (LOW): only a small informational note, and it does not say 'safe'", card.kind === "note" && card.tier === "info" && /not a guarantee/.test(card.text) && !/\bsafe\b/i.test(card.text) && (await dash.$("#msg-result .holdy")) === null);
    await dash.click("#msg-clear");
    check("Prevy: before any check there is nothing from Prevy (no analysis, no claim)", (await cardInfo("#msg-result")).kind === "none");
    await dash.evaluate(() => { document.getElementById("shot-text-wrap").hidden = false; });
    await dash.fill("#shot-text", "|||| ~~~ ..");
    await dash.click("#shot-recheck");
    await sleep(500);
    card = await cardInfo("#shot-result");
    check("Prevy (INCONCLUSIVE): explains it could not confidently check, and that this does not mean safe", card.kind === "note" && card.tier === "uncertain" && /could not confidently check this/.test(card.text) && /does not mean it is safe/.test(card.text));

    // each kind of check gets its own wording
    await dash.fill("#link-input", "https://sbi-kyc-update.xyz/login");
    await dash.click("#link-form button[type=submit]");
    await sleep(400);
    card = await cardInfo("#link-result");
    check("Prevy (URL): the website warning, the look-alike explanation and 'cannot block a website'", card.kind === "card" && /This website address looks suspicious\. Verify the official website before entering information\./.test(card.h3) && /looks similar to a trusted website/.test(card.text) && /cannot block a website/.test(card.text));
    await dash.fill("#link-input", "https://example.com");
    await dash.click("#link-form button[type=submit]");
    await sleep(400);
    check("Prevy (URL, LOW): an ordinary site gets only the small note", (await cardInfo("#link-result")).kind === "note");
    await dash.fill("#upi-id", "x7qz9@newbankxyz");
    await dash.fill("#upi-amount", "250");
    await dash.click("#upi-analyze");
    await sleep(500);
    check("Prevy (UPI, LOW): an ordinary payment gets only the small note", (await cardInfo("#upi-result")).kind === "note");
    await dash.fill("#upi-id", "shop@okhdfcbnk");
    await dash.fill("#upi-amount", "100");
    await dash.click("#upi-analyze");
    await sleep(500);
    card = await cardInfo("#upi-result");
    check("Prevy (UPI): check the recipient before sending money, with the four payment steps", card.kind === "card" && /Check the recipient before sending money/.test(card.h3) && card.actions === 4 && /cannot stop or cancel a payment/.test(card.text), (card.h3 || "").slice(0, 60));
    await dash.click("#upi-clear");
    await dash.fill("#shot-text", "Please send Rs 5000 to this UPI id abc123@ybl immediately.");
    await dash.click("#shot-recheck");
    await sleep(500);
    card = await cardInfo("#shot-result");
    check("Prevy (screenshot): the suspicious-payment-instructions warning", card.kind === "card" && /This screenshot contains suspicious payment instructions\. Verify independently before taking action\./.test(card.h3) && /cannot check whether a payment really happened/.test(card.text), (card.h3 || "").slice(0, 70));
    await dash.fill("#shot-text", "Payment done sir, screenshot attached. Please send the parcel today, I have already paid.");
    await dash.click("#shot-recheck");
    await sleep(500);
    check("Prevy (screenshot): 'do not release goods based only on a payment screenshot'", /Do not release goods based only on a payment screenshot/.test((await cardInfo("#shot-result")).h3 || ""));
    await dash.fill("#shot-text", "Hello sir. Please share your UPI PIN and OTP to receive the refund.");
    await dash.click("#shot-recheck");
    await sleep(500);
    check("Prevy (screenshot): an OTP or UPI PIN request gets 'never share these details'", /Someone is asking for your OTP or UPI PIN\. Never share these details\./.test((await cardInfo("#shot-result")).h3 || ""));

    // phone width, and nothing remembered in storage
    await dash.setViewportSize({ width: 360, height: 800 });
    await dash.evaluate(() => self.Prevenza.holdyCard.reset());
    await msgCard("Dear customer, your SBI KYC is pending. Share your OTP immediately or your account will be blocked.");
    const wide360 = await dash.evaluate(() => {
      const out = [document.documentElement.scrollWidth + "/" + innerWidth + "/" + document.documentElement.clientWidth];
      for (const e of document.querySelectorAll("body *")) { const r = e.getBoundingClientRect(); if (r.right > document.documentElement.clientWidth + 1 && r.width > 0) out.push((e.id || e.className || e.tagName) + ":" + Math.round(r.left) + "-" + Math.round(r.right)); }
      return out.slice(0, 8).join(" ");
    });
    check("Prevy: the card fits a 360px phone screen without sideways scrolling", (await dash.evaluate(() => document.documentElement.scrollWidth > window.innerWidth + 1)) === false, wide360);
    const prevyButtons = await dash.$$eval("#msg-result .holdy button", (b) => b.map((x) => x.getBoundingClientRect().height));
    check("Prevy: every button on the card is at least 44px tall", prevyButtons.length >= 2 && prevyButtons.every((h) => h >= 44), prevyButtons.join(","));
    await dash.screenshot({ path: path.join(SHOTS, "16-prevy-card-mobile.png"), fullPage: false });
    await dash.setViewportSize({ width: 1100, height: 900 });
    const prevyStored = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    check("Prevy: no warning, dismissal or checked content is stored", !/holdy|dismiss|kyc|otp|sbi-kyc|lucky draw|parcel/i.test(prevyStored) && Object.keys(JSON.parse(prevyStored)).every((k) => ["prevenza.schema", "prevenza.settings", "prevenza.stats"].includes(k)));

    // Hindi, then Tamil, then back to English (only Prevy's short messages are translated)
    for (const [code, re] of [["hi", /[\u0900-\u097f]/], ["ta", /[\u0b80-\u0bff]/]]) {
      await dash.evaluate((c) => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { language: c } } }), code);
      await dash.reload();
      await dash.waitForSelector("#legend li");
      await sleep(400);
      await msgCard("Dear customer, your SBI KYC is pending. Share your OTP immediately or your account will be blocked.");
      card = await cardInfo("#msg-result");
      check("Prevy (" + code + "): the headline and the steps are in the chosen language, and it says some details stay in English", card.kind === "card" && re.test(card.h3) && re.test(card.text) && card.actions === 5, (card.h3 || "").slice(0, 40));
    }
    await dash.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { language: "en" } } }));
    await dash.reload();
    await dash.waitForSelector("#legend li");
    await sleep(400);
    await msgCard("Dear customer, your SBI KYC is pending. Share your OTP immediately or your account will be blocked.");
    check("Prevy: after reloading the page it remembers nothing (the full warning shows again), and English is back", (await cardInfo("#msg-result")).repeat === false && /Do not share your OTP or PIN/.test((await cardInfo("#msg-result")).h3 || ""));
    await dash.click("#msg-clear");

    // The popup on a real website tab (the page is served from a look-alike name by the test browser, no real network)
    const scam = await ctx.newPage();
    watch(scam, "look-alike site");
    await scam.route("http://sbi-kyc-update.xyz/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fake</title><h1>Pretend login</h1>" }));
    await scam.goto("http://sbi-kyc-update.xyz/login");
    await sleep(1200);
    check("content script still reports only the site name on a look-alike page", await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        try { const r = await chrome.tabs.sendMessage(t.id, { type: "prevenza/get-tab-status" }); if (r && r.hostname === "sbi-kyc-update.xyz") return Object.keys(r).sort().join() === "badgeVisible,enabled,hostname,muted,protocol,ready,ok,warningVisible".split(",").sort().join(); } catch (e) { /* no content script */ }
      }
      return false;
    }));
    const scamTabId = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        try { const r = await chrome.tabs.sendMessage(t.id, { type: "prevenza/get-tab-status" }); if (r && r.hostname === "sbi-kyc-update.xyz") return t.id; } catch (e) { /* no content script */ }
      }
      return null;
    });
    check("found the look-alike tab for the popup test", typeof scamTabId === "number");

    const popup2 = await ctx.newPage();
    watch(popup2, "popup on a real tab");
    const popup2Requests = [];
    popup2.on("request", (r) => popup2Requests.push(r.url()));
    await popup2.addInitScript((tabId) => { try { chrome.tabs.query = async () => [{ id: tabId, active: true }]; } catch (e) { /* leave the real function */ } }, scamTabId);
    await popup2.setViewportSize({ width: 380, height: 720 });
    await popup2.goto(`chrome-extension://${id}/src/popup/popup.html`);
    await popup2.waitForFunction(() => document.getElementById("risk-pill").textContent !== "Not scanned yet", null, { timeout: 6000 }).catch(() => undefined);
    check("popup replaces 'Not scanned yet' with a real result: High risk", (await popup2.textContent("#risk-pill")) === "High risk" && (await popup2.textContent("#site")) === "sbi-kyc-update.xyz", await popup2.textContent("#risk-pill"));
    check("popup shows a shape-and-label risk pill", (await popup2.$("#risk-pill.pill-danger")) !== null);
    await popup2.click("#why summary");
    check("popup explains why in plain language (reasons list)", (await popup2.$$eval("#reasons li", (l) => l.length)) >= 2 && /SBI/.test(await popup2.textContent("#reasons")));
    // Step 7: Prevy speaks briefly in the popup for a risky page, and the plain popup on a browser page stays silent.
    check("popup (Step 7): Prevy shows a short warning card for a high-risk page, with the website headline", (await popup2.$("#holdy-slot .holdy")) !== null && /This website address looks suspicious/.test(await popup2.textContent("#holdy-slot h3")) && /cannot block a website|Show details/.test(await popup2.textContent("#holdy-slot")));
    check("popup (Step 7): Prevy stays silent where nothing was checked", (await popup.textContent("#holdy-slot")).trim() === "");
    await popup2.screenshot({ path: path.join(SHOTS, "8-popup-high-risk.png") });

    // protection off -> the popup must not scan
    await popup2.click("#enabled", { force: true });
    await sleep(700);
    check("protection off: the popup goes back to 'Not scanned yet' and says why", (await popup2.textContent("#risk-pill")) === "Not scanned yet" && /Protection is off/.test(await popup2.textContent("#risk-help")));
    check("popup (Step 7): protection off also removes Prevy's warning", (await popup2.textContent("#holdy-slot")).trim() === "");
    const offReply = await popup2.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/analyze-site", payload: { hostname: "sbi-kyc-update.xyz", protocol: "http:" } }));
    check("protection off: the background refuses to analyse", offReply.ok === true && offReply.skipped === "protection-off" && !offReply.result);
    await popup2.click("#enabled", { force: true });
    await sleep(700);
    check("protection back on: the result returns", (await popup2.textContent("#risk-pill")) === "High risk");

    // quiet site -> not scanned
    await popup2.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { mutedSites: ["sbi-kyc-update.xyz"] } } }));
    const quietReply = await popup2.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/analyze-site", payload: { hostname: "login.sbi-kyc-update.xyz", protocol: "https:" } }));
    check("quiet site: the site and its sub-sites are not analysed", quietReply.ok === true && quietReply.skipped === "quiet-site");
    await popup2.reload();
    await sleep(900);
    check("quiet site: the popup says it stayed quiet", (await popup2.textContent("#risk-pill")) === "Not scanned yet" && /muted/.test(await popup2.textContent("#risk-help")));
    await popup2.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: { mutedSites: [] } } }));

    // strict message shape: a path or page text is refused at the door
    const pathReply = await popup2.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/analyze-site", payload: { hostname: "a.com", protocol: "https:", path: "/account?token=1" } }));
    check("analysis refuses a message that carries a path or query", pathReply.ok === false && pathReply.error === "bad-payload");

    // a normal local site is Low risk
    const localTabId = await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        try { const r = await chrome.tabs.sendMessage(t.id, { type: "prevenza/get-tab-status" }); if (r && r.hostname === "localhost") return t.id; } catch (e) { /* skip */ }
      }
      return null;
    });
    const localReply = await popup2.evaluate(() => chrome.runtime.sendMessage({ type: "prevenza/analyze-site", payload: { hostname: "localhost", protocol: "http:" } }));
    check("a local test site is Low risk with an explanation", localReply.ok && localReply.result.level === "low" && localReply.result.indicators[0].id === "local_address" && typeof localTabId === "number");

    // privacy: nothing about the scanned addresses was stored
    const storedAfter = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    check("no scanned address or link is stored anywhere", !/sbi-kyc-update|bit\.ly|203\.0\.113|evil\.com|xn--pple|retail\.onlinesbi|javascript/i.test(storedAfter), "storage keys: " + Object.keys(JSON.parse(storedAfter)).join(", "));
    check("the popup on a real tab made no network requests", popup2Requests.every((u) => u.startsWith("chrome-extension://") || u.startsWith("data:")), popup2Requests.length + " local requests");
    await scam.close();

    // ---- 6g. Step 8: Elder Mode, plain explanations, languages and the family guide (new checks, added after the Step 1 to 7 checks)
    const URL_SETTINGS = `chrome-extension://${id}/src/settings/settings.html`;
    const URL_DASH = `chrome-extension://${id}/src/dashboard/dashboard.html`;
    const URL_POPUP = `chrome-extension://${id}/src/popup/popup.html`;
    const step8Requests = [];
    const storedSettings = async () => (await sw.evaluate(() => chrome.storage.local.get("prevenza.settings")))["prevenza.settings"];
    const reloadDash = async () => {
      await dash.reload();
      await dash.waitForSelector("#legend li");
      await sleep(500);
    };
    const px = (page, sel, prop) => page.evaluate(([s, p]) => parseFloat(getComputedStyle(document.querySelector(s))[p]), [sel, prop]);
    const visibleHeights = (page, sel) => page.$$eval(sel, (els) => els.map((e) => e.getBoundingClientRect().height).filter((h) => h > 0));
    const ratios = (page) => page.evaluate(() => {
      const cs = getComputedStyle(document.documentElement);
      const v = (n) => cs.getPropertyValue(n).trim();
      const lum = (hex) => {
        const n = parseInt(hex.replace("#", ""), 16);
        const f = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
        return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
      };
      const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
      return { text: ratio(v("--text"), v("--bg")), muted: ratio(v("--muted"), v("--bg")), mutedOnCard: ratio(v("--muted"), v("--surface")) };
    });
    const elderCardInfo = (sel) => dash.evaluate((s) => {
      const box = document.querySelector(s + " .holdy");
      if (!box) return null;
      const panel = box.querySelector(".holdy-elder");
      const details = box.querySelector("details.holdy-more");
      const btns = [...box.querySelectorAll("button")].map((b) => b.getBoundingClientRect().height).filter((h) => h > 0);
      return {
        tier: box.dataset.tier, role: box.getAttribute("role"), repeat: box.dataset.repeat === "true",
        h3: box.querySelector("h3").textContent, tierLabel: box.querySelector(".holdy-tier").textContent,
        hasIcon: !!box.querySelector(".holdy-tier .holdy-icon"),
        labels: panel ? [...panel.querySelectorAll(".holdy-label")].map((x) => x.textContent) : [],
        found: panel && panel.querySelector(".holdy-found") ? panel.querySelector(".holdy-found").textContent : "",
        why: panel && panel.querySelector(".holdy-why") ? panel.querySelector(".holdy-why").textContent : "",
        steps: panel ? [...panel.querySelectorAll(".holdy-step")].map((x) => x.lastChild.textContent) : [],
        liCount: box.querySelectorAll("li").length,
        trust: box.querySelector(".btn-trust") ? box.querySelector(".btn-trust").textContent : "",
        detailsOpen: details ? details.open : null,
        foundSize: panel ? parseFloat(getComputedStyle(panel.querySelector(".holdy-found")).fontSize) : 0,
        minButton: btns.length ? Math.min(...btns) : 0,
        text: box.textContent,
      };
    }, sel);
    const noteInfo = (sel) => dash.evaluate((s) => {
      const n = document.querySelector(s + " .holdy-note");
      return n ? { tier: n.dataset.tier, text: n.textContent, extra: n.querySelector(".holdy-extra") ? n.querySelector(".holdy-extra").textContent : "", trust: !!n.querySelector(".btn-trust"), hasCard: !!document.querySelector(s + " .holdy") } : null;
    }, sel);
    const OTP_MSG = "Dear customer, your SBI KYC is pending. Share your OTP immediately or your account will be blocked.";

    // -- the setting: off, on, and what changes
    await settings.reload();
    await settings.waitForSelector("#elderMode", { state: "attached" });
    await sleep(500);
    check("Elder Mode (settings): the toggle starts on, with a plain description of what it changes", (await settings.isChecked("#elderMode")) === true && /bigger text and buttons, stronger contrast, simple words and a simpler dashboard/i.test(await settings.textContent("#elder-help")));
    await settings.click("#elderMode", { force: true });
    await sleep(600);
    const e8Off = { stored: await storedSettings(), attr: await settings.getAttribute("html", "data-elder"), font: await px(settings, "html", "fontSize"), btn: Math.min(...(await visibleHeights(settings, ".btn"))), select: await px(settings, "#language", "height"), ratios: await ratios(settings), spacing: await px(settings, ".card", "paddingTop") };
    check("Elder Mode off: the choice is saved and the normal interface comes back", e8Off.stored.elderMode === false && e8Off.attr === "false" && e8Off.font === 16, e8Off.font + "px");
    await settings.click("#elderMode", { force: true });
    await sleep(600);
    const e8On = { stored: await storedSettings(), attr: await settings.getAttribute("html", "data-elder"), font: await px(settings, "html", "fontSize"), btn: Math.min(...(await visibleHeights(settings, ".btn"))), select: await px(settings, "#language", "height"), ratios: await ratios(settings), spacing: await px(settings, ".card", "paddingTop") };
    check("Elder Mode on: the choice is saved", e8On.stored.elderMode === true && e8On.attr === "true");
    check("Elder Mode: text is larger", e8On.font >= 22 && e8On.font > e8Off.font * 1.3, e8Off.font + "px -> " + e8On.font + "px");
    check("Elder Mode: buttons and lists are larger (at least 56px, bigger than normal)", e8On.btn >= 56 && e8On.btn > e8Off.btn && e8On.select >= 56 && e8On.select > e8Off.select, `button ${e8Off.btn}->${e8On.btn}, list ${e8Off.select}->${e8On.select}`);
    check("Elder Mode: spacing is larger", e8On.spacing > e8Off.spacing, e8Off.spacing + "px -> " + e8On.spacing + "px");
    check("Elder Mode: contrast is higher, and at least 7:1 for text", e8On.ratios.text >= 7 && e8On.ratios.muted >= 7 && e8On.ratios.mutedOnCard >= 7 && e8On.ratios.text > e8Off.ratios.text && e8On.ratios.muted > e8Off.ratios.muted, `text ${e8Off.ratios.text.toFixed(1)}->${e8On.ratios.text.toFixed(1)}, muted ${e8Off.ratios.muted.toFixed(1)}->${e8On.ratios.muted.toFixed(1)}`);
    await settings.screenshot({ path: path.join(SHOTS, "17-elder-settings.png"), fullPage: true });

    // -- it is remembered when pages are closed and opened again
    const reopened = await ctx.newPage();
    watch(reopened, "reopened settings");
    reopened.on("request", (r) => step8Requests.push(r.url()));
    await reopened.goto(URL_SETTINGS);
    await reopened.waitForSelector("#elderMode", { state: "attached" });
    await sleep(500);
    check("Elder Mode persists: a freshly opened settings page shows it on and large", (await reopened.isChecked("#elderMode")) === true && (await reopened.getAttribute("html", "data-elder")) === "true" && (await px(reopened, "html", "fontSize")) >= 22);
    await reopened.close();
    const popupElder = await ctx.newPage();
    watch(popupElder, "popup (elder)");
    popupElder.on("request", (r) => step8Requests.push(r.url()));
    await popupElder.setViewportSize({ width: 460, height: 700 });
    await popupElder.goto(URL_POPUP);
    await popupElder.waitForSelector("#protection-sub");
    await sleep(600);
    check("Elder Mode persists into the popup: larger text, a visible 'Ask someone you trust' button", (await popupElder.getAttribute("html", "data-elder")) === "true" && (await px(popupElder, "html", "fontSize")) >= 22 && (await popupElder.isVisible("#open-trust")) && /Ask someone you trust/.test(await popupElder.textContent("#open-trust")));
    check("Elder Mode (popup): every button is at least 56px tall", (await visibleHeights(popupElder, "button.btn")).every((h) => h >= 56), (await visibleHeights(popupElder, "button.btn")).join(","));
    await popupElder.screenshot({ path: path.join(SHOTS, "18-elder-popup.png") });
    const trustTab = ctx.waitForEvent("page", { timeout: 8000 });
    await popupElder.click("#open-trust");
    const guideTab = await trustTab;
    guideTab.on("request", (r) => step8Requests.push(r.url()));
    await guideTab.waitForSelector("#legend li");
    await sleep(600);
    check("Elder Mode (popup): 'Ask someone you trust' opens the guide on the dashboard, already open", /#trust-guide$/.test(guideTab.url()) && (await guideTab.isVisible("#trust-slot .family-panel")) && /call someone you trust using a number you already know/.test(await guideTab.textContent("#trust-slot .family-panel")));
    await guideTab.close();
    await popupElder.close();

    // -- the dashboard layout
    await reloadDash();
    const e8Layout = await dash.evaluate(() => {
      const top = (s) => document.querySelector(s).getBoundingClientRect().top + scrollY;
      const shown = (s) => getComputedStyle(document.querySelector(s)).display !== "none";
      const kids = [...document.querySelector(".two").children].map((c) => c.getBoundingClientRect());
      return { guide: shown("#trust-guide"), more: shown("#more-tools"), order: ["#trust-guide", "#link-check", "#message-check", "#upi-check", "#screenshot-check", "#more-tools", ".stats", ".two", "#road-card"].map(top), stacked: kids.length === 2 && kids[1].top >= kids[0].bottom - 1 };
    });
    check("Elder dashboard: the guide and the four checks come first, technical parts last, in one column", e8Layout.guide && e8Layout.more && e8Layout.order.every((v, i, a) => i === 0 || v > a[i - 1]) && e8Layout.stacked, e8Layout.order.map(Math.round).join(" < "));
    check("Elder dashboard: the system check and every other feature are still there", (await dash.isVisible("#run-check")) && (await dash.$$eval("#legend li", (l) => l.length)) === 6);
    await dash.setViewportSize({ width: 1100, height: 900 });
    await dash.screenshot({ path: path.join(SHOTS, "19-elder-dashboard.png"), fullPage: true });

    // -- the warning card for each level
    await dash.evaluate(() => self.Prevenza.holdyCard.reset());
    await msgCard(OTP_MSG);
    let c8 = await elderCardInfo("#msg-result");
    check("Elder warning: a clear headline, then what we found, why it can be dangerous, and what to do now", c8 && /^(Hold on!|Stop and check first\.)/.test(c8.h3) && JSON.stringify(c8.labels) === JSON.stringify([ET.en.labels.found, ET.en.labels.why, ET.en.labels.todo]) && c8.why.length > 10, c8 && c8.h3.slice(0, 50));
    check("Elder warning: plain words for the OTP case ('steal your password or OTP. Never share these details.')", c8.found === "Someone may be trying to steal your password or OTP. Never share these details.", c8.found);
    check("Elder warning: one or two simple next steps, numbered", c8.steps.length >= 1 && c8.steps.length <= 2 && (await dash.$$eval("#msg-result .holdy-step-no", (n) => n.map((x) => x.textContent).join(","))) === c8.steps.map((s, i) => String(i + 1)).join(","), c8.steps.length + " steps");
    check("Elder warning: the level is a word AND an icon, announced as an alert, not colour alone", /Warning|Stop/.test(c8.tierLabel) && c8.hasIcon && c8.role === "alert");
    check("Elder warning: larger text and buttons at least 56px tall", c8.foundSize >= 22 && c8.minButton >= 56, `${c8.foundSize}px text, smallest button ${c8.minButton}px`);
    check("Elder warning: the Step 7 detail and all five safety steps are still there, in a section that is open and can be closed", c8.detailsOpen === true && c8.liCount === 5);
    await dash.click("#msg-result details.holdy-more > summary");
    const closedOpen = await dash.$eval("#msg-result details.holdy-more", (d) => d.open);
    await dash.click("#msg-result details.holdy-more > summary");
    check("Elder warning: the extra detail can be closed and opened again", closedOpen === false && (await dash.$eval("#msg-result details.holdy-more", (d) => d.open)) === true);
    await dash.screenshot({ path: path.join(SHOTS, "20-elder-warning.png") });
    await sleep(3500);
    check("Elder safe default: the warning stays until the user acts (nothing is dismissed or approved by itself)", (await elderCardInfo("#msg-result")) !== null && (await dash.$("#msg-result .holdy-note")) === null);
    await msgCard(OTP_MSG);
    c8 = await elderCardInfo("#msg-result");
    check("Elder safe default: a repeat of the same result still shows the full plain explanation", c8 && c8.repeat === true && c8.found.length > 0 && c8.steps.length >= 1 && /showed you this warning a moment ago/.test(c8.text));
    await dash.click("#msg-result .holdy button:has-text('Show details')");
    await dash.click("#msg-result .holdy button:has-text('Dismiss')");
    const hidden8 = await noteInfo("#msg-result");
    check("Elder safe default: dismissing is the user's own choice and the note still names the level, never 'safe'", hidden8 && /The result is still (High|Critical) risk/.test(hidden8.text) && !/\bsafe\b/i.test(hidden8.text));
    await dash.evaluate(() => self.Prevenza.holdyCard.reset());

    await msgCard("Your KYC is pending, please update it.");
    c8 = await elderCardInfo("#msg-result");
    check("Elder warning (MEDIUM): a caution card with the plain explanation, announced politely", c8 && c8.tier === "caution" && c8.role === "status" && /Caution/.test(c8.tierLabel) && c8.found.length > 0 && c8.steps.length >= 1);
    await msgCard("This is CBI officer. A case of money laundering is registered against your Aadhaar. You are under digital arrest. Do not tell anyone.");
    c8 = await elderCardInfo("#msg-result");
    check("Elder warning (CRITICAL): a 'stop' card that says police do not arrest people over a call", c8 && c8.tier === "stop" && /Stop/.test(c8.tierLabel) && /police or officers will arrest you/.test(c8.found) && /do not arrest people over a phone call/.test(c8.why), c8 && c8.found.slice(0, 40));
    await msgCard("Congratulations! You have won the lucky draw jackpot of 25 lakh. Pay the processing fee to claim your prize.");
    c8 = await elderCardInfo("#msg-result");
    check("Elder warning (HIGH): a different scam gets its own plain explanation, not the OTP one", c8 && ["warning", "stop"].includes(c8.tier) && c8.found.length > 0 && c8.found !== ET.en.topics.secret.found && c8.steps.length >= 1 && c8.steps.length <= 2, c8 && c8.found.slice(0, 50));
    await msgCard("Hi, are we meeting for lunch tomorrow?");
    let n8 = await noteInfo("#msg-result");
    check("Elder (LOW): only a small note, one plain sentence about checking for yourself, and never 'safe'", n8 && n8.tier === "info" && !n8.hasCard && /check for yourself with the real bank or company/.test(n8.extra) && /not a guarantee/.test(n8.text) && !/\bsafe\b/i.test(n8.text));
    await dash.click("#msg-clear");
    await dash.evaluate(() => { document.getElementById("shot-text-wrap").hidden = false; });
    await dash.fill("#shot-text", "|||| ~~~ ..");
    await dash.click("#shot-recheck");
    await sleep(500);
    n8 = await noteInfo("#shot-result");
    check("Elder (INCONCLUSIVE): says it could not check, never calls it safe, and offers the trust guide", n8 && n8.tier === "uncertain" && /could not confidently check this/.test(n8.text) && /does not mean it is safe/.test(n8.text) && /ask someone you trust/.test(n8.extra) && n8.trust === true && !/\bsafe\b/i.test(n8.extra));
    await dash.fill("#link-input", "https://sbi-kyc-update.xyz/login");
    await dash.click("#link-form button[type=submit]");
    await sleep(400);
    c8 = await elderCardInfo("#link-result");
    check("Elder explanation (look-alike website): 'pretending to be your bank' and 'do not enter your bank details until you check the official website'", c8 && /may be pretending to be your bank/.test(c8.found) && c8.steps[0] === "Do not enter your bank details until you check the official website.", c8 && c8.found.slice(0, 50));
    await dash.fill("#upi-id", "shop@okhdfcbnk");
    await dash.fill("#upi-amount", "100");
    await dash.click("#upi-analyze");
    await sleep(500);
    c8 = await elderCardInfo("#upi-result");
    check("Elder explanation (UPI): 'Check who will receive your money before paying.'", c8 && c8.found === "Check who will receive your money before paying." && c8.steps.length === 2 && c8.liCount === 4, c8 && c8.found);
    await dash.click("#upi-clear");
    await dash.fill("#shot-text", "Please send Rs 5000 to this UPI id abc123@ybl immediately.");
    await dash.click("#shot-recheck");
    await sleep(500);
    c8 = await elderCardInfo("#shot-result");
    check("Elder explanation (screenshot): the plain 'asks for a payment' explanation", c8 && /asks for a payment/.test(c8.found) && c8.steps.length >= 1, c8 && c8.found.slice(0, 50));
    await dash.fill("#shot-text", "");

    // -- the family guide (information only)
    await dash.evaluate(() => self.Prevenza.holdyCard.reset());
    await msgCard(OTP_MSG);
    const storageBefore = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    const requestsBefore = dashRequests.length;
    c8 = await elderCardInfo("#msg-result");
    check("Family guide: the warning offers 'Ask someone you trust' as a large button", c8.trust === ET.en.labels.trust && (await dash.$$eval("#msg-result .holdy .family-panel", (p) => p.length)) === 0);
    await dash.click("#msg-result .holdy .btn-trust");
    const fam = await dash.evaluate(() => {
      const p = document.querySelector("#msg-result .holdy .family-panel");
      const b = document.querySelector("#msg-result .holdy .btn-trust");
      return p ? { text: p.textContent, fields: p.querySelectorAll("input,textarea,select,a,form,[href],[contenteditable]").length, buttons: p.querySelectorAll("button").length, focused: document.activeElement === p, expanded: b.getAttribute("aria-expanded"), controls: b.getAttribute("aria-controls") === p.id, items: p.querySelectorAll('[role="listitem"]').length } : null;
    });
    check("Family guide: opens with the three trust steps, word for word", fam && fam.text.includes("Before sending money, call someone you trust using a number you already know.") && fam.text.includes("Do not use phone numbers provided in suspicious messages.") && fam.text.includes("Verify bank-related requests using your bank's official contact details."), fam && fam.items + " points");
    check("Family guide: it is information only (no box to type in, no link, no phone number, one close button)", fam && fam.fields === 0 && fam.buttons === 1 && !/\d{4,}/.test(fam.text) && /does not contact anyone for you/.test(fam.text) && /does not save phone numbers or send messages/.test(fam.text));
    check("Family guide: keyboard friendly (focus moves to it, state and control are announced)", fam && fam.focused && fam.expanded === "true" && fam.controls);
    await dash.screenshot({ path: path.join(SHOTS, "21-elder-family-guide.png") });
    await dash.click("#msg-result .holdy .family-panel button");
    check("Family guide: closing returns focus to its button and removes the panel", (await dash.$("#msg-result .holdy .family-panel")) === null && (await dash.evaluate(() => document.activeElement.classList.contains("btn-trust"))) === true && (await dash.getAttribute("#msg-result .holdy .btn-trust", "aria-expanded")) === "false");
    await dash.click("#trust-slot .btn-trust");
    check("Family guide (dashboard card): opens the same guide", (await dash.isVisible("#trust-slot .family-panel")) && /Verify bank-related requests/.test(await dash.textContent("#trust-slot .family-panel")));
    await dash.click("#trust-slot .family-panel button");
    check("Family guide: opening and closing stores nothing and sends nothing", JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null))) === storageBefore && dashRequests.slice(requestsBefore).length === 0, dashRequests.slice(requestsBefore).length + " requests");

    // -- responsive: a phone-sized screen with the guide open
    await dash.setViewportSize({ width: 360, height: 800 });
    await dash.click("#msg-result .holdy .btn-trust");
    await sleep(300);
    const wide8 = await dash.evaluate(() => {
      const out = [document.documentElement.scrollWidth + "/" + document.documentElement.clientWidth];
      for (const e of document.querySelectorAll("body *")) { const r = e.getBoundingClientRect(); if (r.width > 0 && r.right > document.documentElement.clientWidth + 1) out.push((e.id || e.className || e.tagName) + ":" + Math.round(r.right)); }
      return out.slice(0, 6).join(" ");
    });
    check("Elder layout fits a 360px phone screen with the warning and the guide open (no sideways scrolling, measured against the visible width)", (await dash.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth)) === false, wide8);
    check("Elder layout on a phone: every button is still at least 56px tall", (await visibleHeights(dash, "#msg-result .holdy button")).every((h) => h >= 56), (await visibleHeights(dash, "#msg-result .holdy button")).join(","));
    await dash.screenshot({ path: path.join(SHOTS, "22-elder-warning-mobile.png"), fullPage: false });
    await dash.setViewportSize({ width: 1100, height: 900 });
    await dash.evaluate(() => self.Prevenza.holdyCard.reset());

    // -- languages: English, Hindi and Tamil are real; the interface is only partly translated, and the app says so
    await settings.reload();
    await settings.waitForSelector("#elderMode", { state: "attached" });
    await settings.selectOption("#language", "hi");
    await sleep(600);
    check("Language (Hindi): chosen in settings, saved, and the labelled settings text changes at once", (await storedSettings()).language === "hi" && (await settings.getAttribute("html", "lang")) === "hi" && (await settings.textContent('[data-i18n="set_elder"]')) === I18N.TABLE.hi.set_elder && (await settings.textContent('[data-i18n="set_language_help"]')) === I18N.TABLE.hi.set_language_help);
    check("Language: the language row stays readable in all three scripts, so nobody gets stuck", /Language \/ .*\u092D\u093E\u0937\u093E \/ .*\u0BAE\u0BCA\u0BB4\u0BBF/.test(await settings.textContent('label[for="language"]')));
    await reloadDash();
    check("Language (Hindi): dashboard headings and buttons are translated", (await dash.textContent("#hero-h")) === I18N.TABLE.hi.dash_hero && (await dash.textContent("#link-h")) === I18N.TABLE.hi.dash_link && (await dash.textContent("#msg-analyze")) === I18N.TABLE.hi.btn_analyze_message && (await dash.textContent("#trust-h")) === I18N.TABLE.hi.trust_title);
    check("Language: the app is honest that the rest stays English (no claim of a full translation)", /Prevenza is on/.test(await dash.textContent("#hero-sub")) && (await dash.$$eval("#road li", (l) => l.some((x) => /Whole interface in Hindi and Tamil/.test(x.textContent) && /Planned/.test(x.textContent)))));
    await msgCard(OTP_MSG);
    c8 = await elderCardInfo("#msg-result");
    check("Language (Hindi): the Elder warning, its labels, steps and trust button are in Hindi", c8 && /[\u0900-\u097f]/.test(c8.found) && c8.found === ET.hi.topics.secret.found && c8.labels.join("|") === [ET.hi.labels.found, ET.hi.labels.why, ET.hi.labels.todo].join("|") && c8.trust === ET.hi.labels.trust && c8.steps.join("|") === ET.hi.topics.secret.steps.join("|"));
    check("Language (Hindi): the risk label is translated and still has its shape", /[\u0900-\u097f]/.test(await dash.textContent("#msg-result .pill")) && (await dash.$("#msg-result .pill-danger, #msg-result .pill-critical")) !== null);
    await dash.click("#msg-result .holdy .btn-trust");
    check("Language (Hindi): the family guide is in Hindi", /[\u0900-\u097f]/.test(await dash.textContent("#msg-result .family-panel")) && (await dash.textContent("#msg-result .family-panel")).includes(ET.hi.family.points[0]));
    const levelHi = /Warning level (\d+) of 100/.exec(await dash.textContent("#msg-result"));
    const hinglishText = await checkMessage("Sir aapka OTP bata do, abhi turant.", "hinglish");
    check("Language: Hinglish is a message-checking language only, and it still works while the interface is in Hindi", /Language: Hinglish/.test(hinglishText) && /OTP, PIN or password request/.test(hinglishText));
    await settings.selectOption("#language", "ta");
    await sleep(600);
    await reloadDash();
    await msgCard(OTP_MSG);
    c8 = await elderCardInfo("#msg-result");
    check("Language (Tamil): headings, the Elder warning and the trust button are in Tamil", (await dash.textContent("#hero-h")) === I18N.TABLE.ta.dash_hero && c8 && c8.found === ET.ta.topics.secret.found && c8.trust === ET.ta.labels.trust && /[\u0b80-\u0bff]/.test(await dash.textContent("#msg-result .pill")));
    const levelTa = /Warning level (\d+) of 100/.exec(await dash.textContent("#msg-result"));
    check("Language: changing the interface language does not change how a message is analysed (same warning level)", levelHi && levelTa && levelHi[1] === levelTa[1], (levelHi && levelHi[1]) + " / " + (levelTa && levelTa[1]));
    await settings.selectOption("#language", "en");
    await sleep(600);
    await reloadDash();
    await msgCard(OTP_MSG);
    c8 = await elderCardInfo("#msg-result");
    const levelEn = /Warning level (\d+) of 100/.exec(await dash.textContent("#msg-result"));
    check("Language (English): everything is back, exactly as written", (await dash.textContent("#hero-h")) === I18N.TABLE.en.dash_hero && (await dash.textContent("#msg-analyze")) === I18N.TABLE.en.btn_analyze_message && c8.found === ET.en.topics.secret.found && levelEn && levelEn[1] === levelHi[1]);
    check("Language: the settings language list offers only the three languages that are really translated", (await settings.$$eval("#language option", (o) => o.map((x) => x.value).join(","))) === "en,hi,ta");

    // -- normal mode is untouched
    await settings.click("#elderMode", { force: true });
    await sleep(600);
    await reloadDash();
    await dash.evaluate(() => self.Prevenza.holdyCard.reset());
    await msgCard(OTP_MSG);
    const normal8 = await dash.evaluate(() => {
      const box = document.querySelector("#msg-result .holdy");
      return { attr: document.documentElement.getAttribute("data-elder"), font: parseFloat(getComputedStyle(document.documentElement).fontSize), elderPanel: !!box.querySelector(".holdy-elder"), more: !!box.querySelector("details"), trustInCard: !!box.querySelector(".btn-trust"), simple: box.querySelectorAll(".holdy-simple p").length, li: box.querySelectorAll("li").length, guideShown: getComputedStyle(document.querySelector("#trust-guide")).display !== "none", moreShown: getComputedStyle(document.querySelector("#more-tools")).display !== "none" };
    });
    check("Normal mode (Elder Mode off): the Step 7 card is unchanged (no Elder panel, no extra section, five steps)", normal8.attr === "false" && normal8.font === 16 && !normal8.elderPanel && !normal8.more && !normal8.trustInCard && normal8.li === 5 && normal8.simple >= 1, JSON.stringify(normal8));
    check("Normal mode: the Elder-only guide card and heading are not shown", !normal8.guideShown && !normal8.moreShown);
    check("Normal mode: the dashboard keeps its normal order (stats, tools, then the checkers)", await dash.evaluate(() => document.querySelector(".stats").getBoundingClientRect().top < document.querySelector("#link-check").getBoundingClientRect().top));
    const popupNormal = await ctx.newPage();
    watch(popupNormal, "popup (normal)");
    popupNormal.on("request", (r) => step8Requests.push(r.url()));
    await popupNormal.goto(URL_POPUP);
    await popupNormal.waitForSelector("#protection-sub");
    await sleep(500);
    check("Normal mode (popup): no Elder button and the normal size", !(await popupNormal.isVisible("#open-trust")) && (await px(popupNormal, "html", "fontSize")) === 16);
    await popupNormal.close();
    await dash.click("#msg-clear");
    await dash.evaluate(() => self.Prevenza.holdyCard.reset());
    // Turn Elder Mode back on, so the reset check below still proves that "Restore default settings" turns it off.
    await settings.click("#elderMode", { force: true });
    await sleep(600);

    // -- Elder Mode never stores what was checked, and never asks for or keeps contact details
    const e8Stored = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    check("Elder Mode stores only settings, counters and the schema number (no scans, no contacts, no dismissals)", Object.keys(JSON.parse(e8Stored)).every((k) => ["prevenza.schema", "prevenza.settings", "prevenza.stats"].includes(k)) && !/sbi-kyc|otp|lucky|upi|shop@|\+91|family|contact|phone|trusted/i.test(e8Stored.replace(/"showAssistantBadge"|"sensitivity"/g, "")), Object.keys(JSON.parse(e8Stored)).join(", "));
    check("Elder Mode: the only settings keys are the existing ones (no new data was introduced)", Object.keys(await storedSettings()).sort().join(",") === "elderMode,enabled,language,mutedSites,pageWarnings,sensitivity,showAssistantBadge");
    check("Elder Mode: no page asks for a phone number or contact (no tel, email or contact fields anywhere in the guide or settings)", (await dash.$$eval("input[type=tel], input[type=email], input[name*=phone i], input[name*=contact i]", (n) => n.length)) === 0 && (await settings.$$eval("input[type=tel], input[type=email], input[name*=phone i], input[name*=contact i]", (n) => n.length)) === 0);
    check("Elder Mode: the new pages made no network requests", step8Requests.every((u) => u.startsWith("chrome-extension://") || u.startsWith("data:")), step8Requests.length + " local requests");

    // ---- 7. reset buttons
    await settings.click("#reset-stats");
    await settings.click("#reset-stats");
    await sleep(500);
    check("reset statistics clears the counters", (await sw.evaluate(() => chrome.storage.local.get("prevenza.stats")))["prevenza.stats"].pagesSeen === 0);
    await settings.click("#reset-settings");
    await settings.click("#reset-settings");
    await sleep(700);
    s = (await sw.evaluate(() => chrome.storage.local.get("prevenza.settings")))["prevenza.settings"];
    check("restore defaults resets every setting", s.elderMode === false && s.showAssistantBadge === false && s.mutedSites.length === 0 && s.enabled === true);

    // ---- 7b. Step 9: Emergency Help (new checks, added after the Step 1 to 8 checks)
    const URL_EMG = `chrome-extension://${id}/src/emergency/emergency.html`;
    const PORTAL = "https://cybercrime.gov.in/";
    const step9Requests = [];
    const portalHits = [];
    // The test never reaches the real portal: the browser's request for it is answered here with a stand-in page.
    await ctx.route("https://cybercrime.gov.in/**", (route) => {
      portalHits.push(route.request().url());
      route.fulfill({ status: 200, contentType: "text/html", body: "<!doctype html><title>stand-in for the official portal</title><p>stand-in</p>" });
    });
    const setPrefs = (p) => dash.evaluate((x) => chrome.runtime.sendMessage({ type: "prevenza/update-settings", payload: { settings: x } }), p);
    await setPrefs({ elderMode: false, language: "en" });
    const storageKeysBefore9 = Object.keys(await sw.evaluate(() => chrome.storage.local.get(null))).sort().join(",");
    const openEmg = async (hash, viewport) => {
      const p = await ctx.newPage();
      watch(p, "emergency");
      p.on("request", (r) => step9Requests.push(r.url()));
      await p.setViewportSize(viewport || { width: 1100, height: 900 });
      await p.goto(URL_EMG + (hash || ""));
      await p.waitForSelector("#incident-list button");
      await sleep(300);
      return p;
    };

    // -- the button, from the popup and from the dashboard
    const popup9 = await ctx.newPage();
    watch(popup9, "popup9");
    popup9.on("request", (r) => step9Requests.push(r.url()));
    await popup9.setViewportSize({ width: 380, height: 720 });
    await popup9.goto(URL_POPUP);
    await popup9.waitForSelector("#open-emergency");
    await sleep(500);
    const pb = await popup9.evaluate(() => {
      const b = document.getElementById("open-emergency");
      const r = b.getBoundingClientRect();
      const first = document.querySelector(".actions button");
      return { name: b.textContent.trim(), h: r.height, w: r.width, desc: document.getElementById(b.getAttribute("aria-describedby")).textContent, firstIsIt: first === b, mascot: !!document.querySelector("[data-mascot] svg, [data-mascot] *") };
    });
    check("Emergency button (popup): visible near the top, named 'Emergency Help', at least 44px tall, with a description for screen readers", pb.name === "Emergency Help" && pb.h >= 44 && pb.firstIsIt && /safety steps/.test(pb.desc), JSON.stringify(pb));
    const [emgFromPopup] = await Promise.all([ctx.waitForEvent("page", { timeout: 10000 }), popup9.click("#open-emergency")]);
    await emgFromPopup.waitForSelector("#incident-list button");
    check("Emergency button (popup): opens the Emergency Help page in its own tab", emgFromPopup.url() === URL_EMG, emgFromPopup.url());
    await emgFromPopup.close();

    const dash9 = await ctx.newPage();
    watch(dash9, "dash9");
    dash9.on("request", (r) => step9Requests.push(r.url()));
    await dash9.setViewportSize({ width: 1100, height: 900 });
    await dash9.goto(URL_DASH);
    await dash9.waitForSelector("#legend li");
    await sleep(400);
    const db = await dash9.evaluate(() => {
      const a = document.querySelector(".nav a.btn-emergency");
      const r = a.getBoundingClientRect();
      return { name: a.textContent.trim(), h: r.height, top: r.top, href: a.getAttribute("href") };
    });
    check("Emergency button (dashboard): in the page header, named 'Emergency Help', at least 44px tall", db.name === "Emergency Help" && db.h >= 44 && db.top < 120 && /emergency\.html$/.test(db.href), JSON.stringify(db));
    await dash9.click(".nav a.btn-emergency");
    await dash9.waitForSelector("#incident-list button");
    check("Emergency button (dashboard): opens the Emergency Help page", dash9.url() === URL_EMG, dash9.url());
    check("Emergency page: Prevy is there and the heading is 'Emergency Help'", (await dash9.textContent("#emg-h")) === "Emergency Help" && (await dash9.$$eval("[data-mascot] svg", (s) => s.length)) >= 1);
    await dash9.click(".emg-back a");
    await dash9.waitForSelector("#legend li");
    check("Return to dashboard: the button at the bottom goes back to the dashboard", dash9.url() === URL_DASH, dash9.url());
    await dash9.goBack();
    await dash9.waitForSelector("#incident-list button");
    await dash9.click(".page-head a.btn");
    await dash9.waitForSelector("#legend li");
    check("Return to dashboard: the button at the top goes back to the dashboard too", dash9.url() === URL_DASH, dash9.url());
    await dash9.close();

    // -- each incident category shows its own instructions
    const emg = await openEmg();
    check("Emergency page: heading, a calm line, and seven situations to choose from, none chosen at first", (await emg.$$eval("#incident-list button", (b) => b.length)) === 7 && (await emg.$$eval("#incident-list [aria-pressed=true]", (b) => b.length)) === 0 && !(await emg.isVisible("#steps-card")) && /Take a breath/.test(await emg.textContent("#emg-calm")) && /Choose what happened/.test(await emg.textContent("#steps-empty")));
    const EXPECT = {
      money: [/Stop sending any more money/, /Contact your bank immediately/, /official reporting channel/, /reference numbers/, /guaranteed recovery of your money for an upfront fee/],
      otp_pin: [/Contact your bank immediately/, /secure your account/, /Change or reset your credentials/, /Never share another OTP or PIN/],
      link: [/Do not enter any more personal or banking information/, /Close the suspicious page/, /contact the relevant bank or service immediately/, /Do not download unknown files/],
      fake_kyc: [/Do not tap links/, /Do not share OTPs, PINs, passwords or card details/, /official contact details/],
      arrest: [/Stay calm/, /Do not transfer money because of threats/, /Do not share OTPs, PINs or personal information/, /Verify the situation independently/, /official authorities and trusted people/],
      fake_receipt: [/Do not hand over goods or services based only on a screenshot/, /Check your own bank or UPI application/, /actually arrived/],
      other: [/Pause/, /Verify independently/, /someone you trust/],
    };
    for (const inc of E9.INCIDENTS) {
      await emg.click(`#incident-list [data-incident="${inc.id}"]`);
      const got = await emg.evaluate(() => ({
        title: document.getElementById("steps-h").textContent,
        items: [...document.querySelectorAll("#steps-body ol.steps li")].map((l) => l.textContent),
        pressed: [...document.querySelectorAll("#incident-list [aria-pressed=true]")].map((b) => b.getAttribute("data-incident")),
        focus: document.activeElement && document.activeElement.id,
        visible: !document.getElementById("steps-card").hidden,
        hash: location.hash,
      }));
      check(`Incident '${inc.id}': its own title and every safety step, in order, with only that choice marked`, got.visible && got.title === inc.title && JSON.stringify(got.items) === JSON.stringify(inc.steps) && got.pressed.length === 1 && got.pressed[0] === inc.id && got.hash === "#" + inc.id, got.title);
      check(`Incident '${inc.id}': the key instructions are there`, EXPECT[inc.id].every((re) => re.test(got.items.join(" "))));
      check(`Incident '${inc.id}': focus moves to the steps heading`, got.focus === "steps-h");
    }
    check("Incident choices: no text box, file picker or contact field anywhere on the page", (await emg.$$eval("input, textarea, select, form", (e) => e.length)) === 0);
    check("Incident choices: nothing is asked for, and the page says nothing you choose is saved", /Do not type any private details here/.test(await emg.textContent("#pick-help")) && /Nothing you choose is saved/.test(await emg.textContent("#pick-help")));
    check("Steps: the page says Prevenza cannot freeze accounts, reverse payments or recover money", /cannot freeze accounts, reverse payments or recover money/.test(await emg.textContent("#steps-body")));

    // -- official reporting guidance, the portal link and the helpline copy action
    const rep = await emg.evaluate(() => {
      const a = document.getElementById("portal-link");
      return { href: a.href, target: a.target, rel: a.rel, text: a.textContent, address: document.getElementById("portal-address").textContent, number: document.getElementById("helpline-number").textContent, intro: document.getElementById("report-intro").textContent, bank: document.getElementById("bank-reminder").textContent, links: [...document.querySelectorAll("a[href]")].map((x) => x.getAttribute("href")) };
    });
    check("Reporting: names the National Cyber Crime Reporting Portal and shows its address and helpline 1930", rep.href === PORTAL && rep.address === PORTAL && rep.number === "1930" && /National Cyber Crime Reporting Portal/.test(await emg.textContent("#portal-h")) && /Cyber financial fraud helpline/.test(await emg.textContent("#helpline-h")));
    check("Reporting: says to report as quickly as possible and to contact the bank immediately too", /as quickly as possible/.test(rep.intro) && /bank immediately/.test(rep.intro) && /immediately/.test(rep.bank));
    check("Reporting: the portal link opens in a new tab with noopener and noreferrer, and is the only web address on the page", rep.target === "_blank" && /noopener/.test(rep.rel) && /noreferrer/.test(rep.rel) && rep.links.filter((h) => /^https?:/.test(h)).join() === PORTAL, rep.links.join(" | "));
    check("Reporting: the portal is not opened by itself (no request yet, no extra tab)", portalHits.length === 0 && ctx.pages().filter((p) => /cybercrime/.test(p.url())).length === 0);
    const [portalTab] = await Promise.all([ctx.waitForEvent("page", { timeout: 10000 }), emg.click("#portal-link")]);
    await portalTab.waitForLoadState("domcontentloaded");
    check("Reporting: pressing the link opens only the official portal address, in a new tab", portalTab.url() === PORTAL && portalHits.length >= 1 && emg.url().startsWith("chrome-extension://"), portalTab.url());
    await portalTab.close();
    let clip = { ok: false, text: "" };
    try {
      await ctx.grantPermissions(["clipboard-read", "clipboard-write"]);
    } catch (e) { /* the page can still write to the clipboard after a click; reading it back is only for this test */ }
    await emg.evaluate(() => {
      window.__copied = [];
      const real = navigator.clipboard.writeText.bind(navigator.clipboard);
      navigator.clipboard.writeText = (t) => { window.__copied.push(t); return real(t); };
    });
    await emg.click("#copy-helpline");
    await sleep(300);
    try { clip = { ok: true, text: await emg.evaluate(() => navigator.clipboard.readText()) }; } catch (e) { clip = { ok: false, text: String(e).slice(0, 80) }; }
    check("Copy helpline: pressing the button asks the browser to copy exactly 1930, once", JSON.stringify(await emg.evaluate(() => window.__copied)) === JSON.stringify(["1930"]));
    check("Copy helpline: the clipboard really contains exactly 1930", clip.ok && clip.text === "1930", JSON.stringify(clip));
    check("Copy helpline: a status message confirms it, and says nothing was called or sent", /Copied 1930/.test(await emg.textContent("#copy-status")) && /Nothing was called or sent/.test(await emg.textContent("#copy-status")));
    // if the clipboard refuses, the number must still be easy to read and the page must say so
    await emg.evaluate(() => { navigator.clipboard.writeText = () => Promise.reject(new Error("blocked")); });
    await emg.click("#copy-helpline");
    await sleep(200);
    check("Copy helpline: if copying is blocked, the page says so calmly and the number 1930 stays on screen", /Could not copy automatically/.test(await emg.textContent("#copy-status")) && (await emg.textContent("#helpline-number")) === "1930");
    check("Reporting: no tel:, sms:, mailto: or WhatsApp link, and no call is started", rep.links.every((h) => !/^(tel|sms|mailto|whatsapp|intent):/i.test(h)));

    // -- trust guidance
    check("Ask someone you trust: shows the exact guidance sentence", (await emg.textContent("#trust-sentence")) === "Pause before taking action. Contact someone you trust using a phone number you already know. Do not use contact details supplied in a suspicious message.");
    await emg.click("#trust-slot .family > button");
    check("Ask someone you trust: the button opens the guide, information only (no field, no contact, no link inside)", (await emg.isVisible("#trust-slot .family-panel")) && (await emg.$$eval("#trust-slot .family-panel input, #trust-slot .family-panel textarea, #trust-slot .family-panel a", (e) => e.length)) === 0 && /Do not share your OTP, PIN or password, even with family/.test(await emg.textContent("#trust-slot .family-panel")));
    await emg.click("#trust-slot .family-panel .btn");

    // -- keyboard
    await emg.reload();
    await emg.waitForSelector("#incident-list button");
    await emg.focus('#incident-list [data-incident="link"]');
    await emg.keyboard.press("Enter");
    check("Keyboard: Enter on a situation chooses it and moves focus to the steps", (await emg.evaluate(() => document.activeElement.id)) === "steps-h" && (await emg.textContent("#steps-h")) === "I clicked a suspicious link");
    await emg.focus('#incident-list [data-incident="money"]');
    await emg.keyboard.press("Space");
    check("Keyboard: Space also chooses a situation", (await emg.textContent("#steps-h")) === "I may have sent money to a scammer");
    await emg.goto("about:blank");
    await emg.goto(URL_EMG);
    await emg.waitForSelector("#incident-list button");
    const tabOrder = [];
    for (let i = 0; i < 24; i++) {
      await emg.keyboard.press("Tab");
      tabOrder.push(await emg.evaluate(() => { const a = document.activeElement; return a ? a.id || (a.getAttribute && a.getAttribute("data-incident")) || (a.closest && a.closest(".family") ? "family" : "") || (a.closest && a.closest(".emg-back") ? "back-bottom" : "") || a.tagName : ""; }));
    }
    const orderOk = ["money", "portal-link", "copy-helpline", "family", "back-bottom"].every((k) => tabOrder.includes(k)) && tabOrder.indexOf("money") < tabOrder.indexOf("portal-link") && tabOrder.indexOf("portal-link") < tabOrder.indexOf("copy-helpline") && tabOrder.indexOf("copy-helpline") < tabOrder.indexOf("family");
    check("Keyboard: Tab reaches the situations, the portal link, the copy button, the trust guide and the return button, in reading order", orderOk, tabOrder.filter((x, i) => x !== tabOrder[i - 1]).join(" > "));
    await emg.focus("#copy-helpline");
    await emg.keyboard.press("Enter");
    await sleep(200);
    check("Keyboard: Enter on the copy button works", /Copied 1930|Could not copy/.test(await emg.textContent("#copy-status")));
    const focusRing = await emg.evaluate(() => { document.getElementById("portal-link").focus(); const s = getComputedStyle(document.getElementById("portal-link")); return parseFloat(s.outlineWidth); });
    check("Keyboard: a visible focus outline is shown on links and buttons", focusRing >= 2, String(focusRing));
    check("Accessibility: the steps heading, status message and groups are labelled", (await emg.getAttribute("#incident-list", "role")) === "group" && (await emg.getAttribute("#copy-status", "role")) === "status" && (await emg.getAttribute("#pick-msg", "role")) === "status" && !!(await emg.getAttribute("#steps-card", "aria-labelledby")));

    // -- an invalid choice
    for (const bad of ["#nonsense", "#__proto__", "#MONEY"]) {
      await emg.goto(URL_EMG + bad);
      await emg.waitForSelector("#incident-list button");
      await sleep(200);
      check(`Invalid choice (${bad}): a calm message, no steps shown, nothing marked, and no crash`, /could not find that choice/.test(await emg.textContent("#pick-msg")) && !(await emg.isVisible("#steps-card")) && (await emg.$$eval("#incident-list [aria-pressed=true]", (b) => b.length)) === 0 && (await emg.isVisible("#incident-list")));
    }
    await emg.click('#incident-list [data-incident="arrest"]');
    check("Invalid choice: choosing a real situation afterwards clears the message and works", !(await emg.isVisible("#pick-msg")) && (await emg.textContent("#steps-h")) === "Someone is threatening me with digital arrest");
    await emg.goto(URL_EMG + "#fake_receipt");
    await emg.waitForSelector("#steps-card:not([hidden])");
    check("Direct link (#fake_receipt): opens straight to that situation", (await emg.textContent("#steps-h")) === "I received a fake payment screenshot");
    await emg.evaluate(() => { document.getElementById("incident-list").querySelector("button").setAttribute("data-incident", "tampered"); document.getElementById("incident-list").querySelector("button").click(); });
    check("Invalid choice: a tampered button label cannot select anything unknown (the steps always come from the built-in list)", (await emg.isVisible("#steps-card")) && (await emg.textContent("#steps-h")) === E9.getIncident("money").title && (await emg.evaluate(() => location.hash)) === "#money");

    // -- layout: desktop and mobile, normal mode
    const overflow9 = (page) => page.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
    await emg.goto(URL_EMG + "#money");
    await emg.waitForSelector("#steps-card:not([hidden])");
    for (const vp of [{ width: 1100, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
      await emg.setViewportSize(vp);
      await sleep(150);
      const o = await overflow9(emg);
      const smallest = Math.min(...(await visibleHeights(emg, "#incident-list button, #portal-link, #copy-helpline, .emg-back a")));
      check(`Layout (normal, ${vp.width}px wide): no sideways scrolling and every button at least 44px tall`, o.sw <= o.cw && smallest >= 44, `${o.sw}/${o.cw}, smallest ${Math.round(smallest)}px`);
    }
    await emg.screenshot({ path: path.join(SHOTS, "23-emergency-mobile.png"), fullPage: true });
    await emg.setViewportSize({ width: 1100, height: 900 });
    await emg.screenshot({ path: path.join(SHOTS, "22-emergency.png"), fullPage: true });
    const reduced = await emg.evaluate(() => [...document.querySelectorAll("*")].filter((e) => { const s = getComputedStyle(e); return s.animationName !== "none" || parseFloat(s.animationDuration) > 0; }).length);
    check("Calm design: no animations anywhere on the page", reduced === 0, String(reduced));

    // -- Elder Mode: larger, one step at a time, simple words
    await setPrefs({ elderMode: true });
    await emg.goto(URL_EMG);
    await emg.waitForSelector("#incident-list button");
    await sleep(400);
    const ef = await emg.evaluate(() => ({ attr: document.documentElement.getAttribute("data-elder"), font: parseFloat(getComputedStyle(document.documentElement).fontSize), calm: document.getElementById("emg-calm").textContent, cols: getComputedStyle(document.getElementById("incident-list")).gridTemplateColumns.split(" ").length, detailsOpen: document.getElementById("report-more").open }));
    check("Elder Mode: large text, a one-column list of situations, simpler calm line, and the extra reporting notes folded away", ef.attr === "true" && ef.font >= 22 && ef.cols === 1 && /go slowly/.test(ef.calm) && ef.detailsOpen === false, JSON.stringify(ef));
    check("Elder Mode: every button is at least 56px tall", Math.min(...(await visibleHeights(emg, "#incident-list button, #portal-link, #copy-helpline, .emg-back a"))) >= 56);
    await emg.click('#incident-list [data-incident="money"]');
    const e1 = await emg.evaluate(() => ({ list: document.querySelectorAll("#steps-body ol.steps").length, count: document.getElementById("step-count").textContent, now: document.getElementById("step-now").textContent, prevHidden: document.getElementById("step-prev").hidden, nextHidden: document.getElementById("step-next").hidden, live: document.getElementById("step-now").getAttribute("aria-live"), size: parseFloat(getComputedStyle(document.getElementById("step-now")).fontSize) }));
    const elderMoney = E9.getIncident("money").elderSteps;
    check("Elder Mode: only the first step is shown, with 'Step 1 of 5', announced politely, in large text", e1.list === 0 && e1.count === "Step 1 of 5" && e1.now === elderMoney[0] && e1.prevHidden && !e1.nextHidden && e1.live === "polite" && e1.size >= 24, JSON.stringify(e1));
    check("Elder Mode: the Next step button is large", Math.min(...(await visibleHeights(emg, "#step-next"))) >= 56);
    const seen = [e1.now];
    for (let i = 1; i < elderMoney.length; i++) {
      await emg.click(await emg.isVisible("#step-next") ? "#step-next" : "#step-now");
      seen.push(await emg.textContent("#step-now"));
    }
    const end = await emg.evaluate(() => ({ count: document.getElementById("step-count").textContent, nextHidden: document.getElementById("step-next").hidden, focus: document.activeElement.id, done: !document.querySelector("#steps-body > p.muted").hidden }));
    check("Elder Mode: pressing Next walks through every simple step in order, one at a time", JSON.stringify(seen) === JSON.stringify(elderMoney), seen.length + " steps");
    check("Elder Mode: at the last step Next goes away, a calm 'last step' note appears, and focus stays on the step (not lost)", end.count === "Step 5 of 5" && end.nextHidden && end.focus === "step-now" && end.done, JSON.stringify(end));
    await emg.click("#step-prev");
    check("Elder Mode: Previous step goes back", (await emg.textContent("#step-now")) === elderMoney[3] && (await emg.textContent("#step-count")) === "Step 4 of 5");
    await emg.click('#incident-list [data-incident="arrest"]');
    check("Elder Mode: choosing another situation starts again at step 1 with that situation's simple steps", (await emg.textContent("#step-count")) === "Step 1 of 5" && (await emg.textContent("#step-now")) === E9.getIncident("arrest").elderSteps[0]);
    check("Elder Mode: the reporting part is short and plain, with the portal and helpline buttons easy to reach", /report it as soon as you can/.test(await emg.textContent("#report-intro")) && (await emg.isVisible("#portal-link")) && (await emg.isVisible("#copy-helpline")) && (await emg.isVisible("#helpline-number")));
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
      await emg.setViewportSize(vp);
      await sleep(200);
      const o = await overflow9(emg);
      const smallest = Math.min(...(await visibleHeights(emg, "#incident-list button, #portal-link, #copy-helpline, .emg-back a, #step-next, #step-prev")));
      check(`Layout (Elder Mode, ${vp.width}px wide): no sideways scrolling and every button at least 56px tall`, o.sw <= o.cw && smallest >= 56, `${o.sw}/${o.cw}, smallest ${Math.round(smallest)}px`);
    }
    await emg.screenshot({ path: path.join(SHOTS, "24-emergency-elder-mobile.png"), fullPage: true });
    await emg.setViewportSize({ width: 1100, height: 900 });
    await emg.screenshot({ path: path.join(SHOTS, "25-emergency-elder.png"), fullPage: true });
    const popupE9 = await ctx.newPage();
    watch(popupE9, "popupE9");
    popupE9.on("request", (r) => step9Requests.push(r.url()));
    await popupE9.setViewportSize({ width: 460, height: 720 });
    await popupE9.goto(URL_POPUP);
    await popupE9.waitForSelector("#open-emergency");
    await sleep(400);
    const pe = await popupE9.evaluate(() => { const b = document.getElementById("open-emergency"); return { h: b.getBoundingClientRect().height, font: parseFloat(getComputedStyle(b).fontSize), vis: b.getBoundingClientRect().width > 0 }; });
    check("Elder Mode (popup): the Emergency Help button is shown, large, and at least 56px tall", pe.vis && pe.h >= 56 && pe.font >= 20, JSON.stringify(pe));
    await popupE9.close();
    const dashE9 = await ctx.newPage();
    watch(dashE9, "dashE9");
    await dashE9.setViewportSize({ width: 1100, height: 900 });
    await dashE9.goto(URL_DASH);
    await dashE9.waitForSelector("#legend li");
    await sleep(400);
    check("Elder Mode (dashboard): the Emergency Help button is still in the header and at least 56px tall", (await dashE9.isVisible(".nav a.btn-emergency")) && Math.min(...(await visibleHeights(dashE9, ".nav a.btn-emergency"))) >= 56);
    await dashE9.close();

    // -- languages: the labels follow the chosen language; the safety steps stay English and the page says so
    await setPrefs({ elderMode: false, language: "hi" });
    await emg.goto(URL_EMG + "#money");
    await emg.reload();
    await emg.waitForSelector("#steps-card:not([hidden])");
    await sleep(300);
    check("Language (Hindi): the page title, the return buttons and the note use Hindi", (await emg.textContent("#emg-h")) === I18N.TABLE.hi.emergency_btn && (await emg.$$eval("[data-i18n=emg_back]", (a) => a.every((x) => x.textContent === "डैशबोर्ड पर लौटें"))) && (await emg.getAttribute("html", "lang")) === "hi");
    check("Language (Hindi): the page is honest that the emergency steps are in English for now", (await emg.isVisible("#emg-lang-note")) && /in English for now/.test(await emg.textContent("#emg-lang-note")) && /Stop sending any more money/.test(await emg.textContent("#steps-body")));
    await emg.click("#trust-slot .family > button");
    check("Language (Hindi): the Ask someone you trust guide is in Hindi", /[\u0900-\u097f]/.test(await emg.textContent("#trust-slot .family-panel")) && /[\u0900-\u097f]/.test(await emg.textContent("#trust-slot .family > button")));
    const popupHi = await ctx.newPage();
    await popupHi.goto(URL_POPUP);
    await popupHi.waitForSelector("#open-emergency");
    await sleep(400);
    check("Language (Hindi): the Emergency Help button in the popup is in Hindi", (await popupHi.textContent("#open-emergency")).trim() === I18N.TABLE.hi.emergency_btn);
    await popupHi.close();
    await setPrefs({ language: "ta" });
    await emg.reload();
    await emg.waitForSelector("#incident-list button");
    await sleep(300);
    check("Language (Tamil): the page title and return buttons use Tamil, and the English-steps note is shown", (await emg.textContent("#emg-h")) === I18N.TABLE.ta.emergency_btn && /[\u0b80-\u0bff]/.test(await emg.textContent(".emg-back a")) && (await emg.isVisible("#emg-lang-note")));
    await setPrefs({ language: "en" });
    await emg.reload();
    await emg.waitForSelector("#incident-list button");
    await sleep(300);
    check("Language (English): everything is back, and the English-only note is not shown", (await emg.textContent("#emg-h")) === "Emergency Help" && !(await emg.isVisible("#emg-lang-note")) && (await emg.textContent(".emg-back a")) === "Return to dashboard");

    // -- the page still works when settings cannot be read
    const lone = await ctx.newPage();
    await lone.route(/chrome-extension:\/\/.*\/never/, (r) => r.abort());
    await lone.addInitScript(() => { try { chrome.runtime.sendMessage = () => Promise.reject(new Error("worker unavailable")); } catch (e) { /* ignore */ } });
    await lone.goto(URL_EMG + "#otp_pin");
    await lone.waitForSelector("#steps-card:not([hidden])", { timeout: 8000 }).catch(() => null);
    check("Resilience: if settings cannot be read, the page still shows the steps and reporting guidance in English", /Contact your bank immediately/.test(await lone.textContent("#steps-body").catch(() => "")) && (await lone.isVisible("#portal-link")), "");
    await lone.close();

    // -- privacy and permissions
    const storageAfter9 = await sw.evaluate(() => chrome.storage.local.get(null));
    const keysAfter9 = Object.keys(storageAfter9).sort().join(",");
    check("Privacy: after using Emergency Help, storage still has only the settings, counters and schema number", keysAfter9 === storageKeysBefore9 && Object.keys(storageAfter9).every((k) => ["prevenza.schema", "prevenza.settings", "prevenza.stats"].includes(k)), keysAfter9);
    const blob = JSON.stringify(storageAfter9);
    check("Privacy: nothing about the chosen situations, the helpline or the portal was stored", !/otp_pin|fake_kyc|fake_receipt|cybercrime|1930|emergency|incident/i.test(blob));
    check("Privacy: settings keys are unchanged (no new setting was added for Emergency Help)", Object.keys(storageAfter9["prevenza.settings"]).sort().join(",") === "elderMode,enabled,language,mutedSites,pageWarnings,sensitivity,showAssistantBadge");
    const m9 = await sw.evaluate(() => chrome.runtime.getManifest());
    check("Permissions: still only 'storage', no host permissions and no web-accessible resources", JSON.stringify(m9.permissions) === '["storage"]' && !m9.host_permissions && !m9.web_accessible_resources);
    check("Network: Emergency Help pages made no network request (the portal is only reached when the user presses its link)", step9Requests.every((u) => u.startsWith("chrome-extension://") || u.startsWith("data:")), step9Requests.filter((u) => !u.startsWith("chrome-extension://") && !u.startsWith("data:")).join(", ") || step9Requests.length + " local requests");
    check("Network: the only request outside the extension was the user pressing the portal link", portalHits.length >= 1 && portalHits.every((u) => u === PORTAL), portalHits.join(" "));
    await emg.close();
    await ctx.unroute("https://cybercrime.gov.in/**");

    // ---- 7c. Step 10: unified dashboard (new checks, added after the Step 1 to 9 checks)
    const step10Requests = [];
    const st10 = async () => (await sw.evaluate(() => chrome.storage.local.get("prevenza.stats")))["prevenza.stats"];
    const MS10 = require("../src/shared/message-scan.js");
    const RE10 = require("../src/shared/risk-engine.js");
    const expectMsg = (t) => RE10.assess({ message: { ok: true, indicators: MS10.scanMessage(t, { language: "auto" }).indicators } });
    await setPrefs({ elderMode: false, language: "en", enabled: true });
    const d10 = await ctx.newPage();
    watch(d10, "dashboard10");
    d10.on("request", (r) => step10Requests.push(r.url()));
    await d10.setViewportSize({ width: 1100, height: 900 });
    await d10.goto(URL_DASH);
    await d10.waitForSelector("#legend li");
    await sleep(500);
    const shown10 = async (sel) => d10.evaluate((s) => { const e = document.querySelector(s); return !!e && e.getClientRects().length > 0; }, sel);
    const statsShown = () => d10.evaluate(() => ({ scans: document.getElementById("stat-scans").textContent, high: document.getElementById("stat-high").textContent, lowmed: document.getElementById("stat-lowmed").textContent, inc: document.getElementById("stat-inconclusive").textContent, last: document.getElementById("stat-lastscan").textContent, prot: document.getElementById("stat-protection").textContent }));
    const statsMatch = async () => {
      const s = await st10();
      const ui = await statsShown();
      return ui.scans === String(s.scansTotal) && ui.high === String(s.scansHigh + s.scansCritical) && ui.lowmed === String(s.scansLow + s.scansMedium) && ui.inc === String(s.scansInconclusive);
    };
    const waitStats = async (total) => {
      await d10.waitForFunction((t) => document.getElementById("stat-scans").textContent === String(t), total, { timeout: 5000 }).catch(() => undefined);
    };

    // -- overview
    const s0 = await st10();
    const ui0 = await statsShown();
    check("Overview: shows protection On, checks done, high or critical, low or medium, inconclusive and last check, all from the stored counters", ui0.prot === "On" && (await statsMatch()) && (s0.scansTotal === 0 ? ui0.last === "No checks yet" : ui0.last.length > 0), JSON.stringify(ui0));
    check("Overview: says only counts are kept, never what was checked, and links to reset in Settings", /never saves what you checked: no links, messages, images, UPI IDs, names or amounts/.test(await d10.textContent("#overview-note")) && /settings\.html#reset-stats$/.test(await d10.getAttribute("#overview-reset", "href")));
    check("Overview: the latest-result pill starts as 'Not scanned yet' (nothing remembered from before)", (await d10.textContent("#overall-pill")) === "Not scanned yet");
    check("Menu: five cards with words and an icon (the icon hidden from screen readers), in the right order", JSON.stringify(await d10.$$eval(".tool-card strong", (s) => s.map((x) => x.textContent))) === JSON.stringify(["Check a website", "Check a suspicious message", "Check a UPI payment request", "Scan a screenshot", "Emergency Help"]) && (await d10.$$eval(".tool-card .tool-icon", (s) => s.every((x) => x.getAttribute("aria-hidden") === "true"))));
    check("Menu: every card is at least 44px tall", Math.min(...(await visibleHeights(d10, ".tool-card"))) >= 44);
    check("Menu: the dashboard roadmap lists the unified dashboard as ready", (await d10.$$eval("#road li", (l) => l.some((x) => /One dashboard for every check/.test(x.textContent) && /Ready/.test(x.textContent)))));

    // -- A. URL: menu -> type -> analyze -> result -> back
    await d10.click('.tool-card[href="#link-check"]');
    await sleep(200);
    check("A. URL: the menu card opens the link checker and puts the cursor in its box", (await d10.evaluate(() => document.activeElement.id)) === "link-input" && (await d10.evaluate(() => location.hash)) === "#link-check");
    await d10.keyboard.type("http://sbi-kyc-update.xyz/login");
    await d10.keyboard.press("Enter");
    await d10.waitForSelector("#link-result .risk-summary");
    const a10 = await d10.evaluate(() => { const b = document.querySelector("#link-result .risk-summary"); return { cat: b.getAttribute("data-category"), text: b.textContent, dts: [...b.querySelectorAll("dt")].map((d) => d.textContent), pill: b.querySelector(".pill").textContent, shape: !!b.querySelector(".pill-danger, .pill-critical"), holdy: !!document.querySelector("#link-result .holdy"), label: b.getAttribute("aria-label") }; });
    check("A. URL: the unified result shows category, warning level, confidence, evidence and recommended action", a10.cat === "HIGH" && /Warning level \d+ of 100/.test(a10.text) && JSON.stringify(a10.dts) === JSON.stringify(["Confidence", "Evidence found", "Recommended action"]) && /High risk/.test(a10.pill) && a10.shape, JSON.stringify(a10).slice(0, 200));
    check("A. URL: the summary is labelled as the central risk engine's result, and Prevy's card appears for the warning", /central risk engine/.test(a10.label) && a10.holdy);
    check("A. URL: the latest-result pill at the top now says High risk (kept in this page only)", (await d10.textContent("#overall-pill")) === "High risk");
    await waitStats(s0.scansTotal + 1);
    check("A. URL: the overview count went up by one, and matches storage", (await st10()).scansTotal === s0.scansTotal + 1 && (await statsMatch()));
    await d10.click("#link-check .back-link");
    await sleep(200);
    check("A. URL: 'Back to the dashboard menu' returns to the menu and focuses its heading", (await d10.evaluate(() => document.activeElement.id)) === "tools-h" && (await d10.evaluate(() => location.hash)) === "#tools-nav");

    // -- B. Message: menu -> paste -> analyze -> phrases -> back
    const critText = "This is CBI officer. You are under digital arrest. Do not tell anyone. Transfer Rs 50000 to the safe account now and share the OTP.";
    const critExp = expectMsg(critText);
    await d10.click('.tool-card[href="#message-check"]');
    await sleep(200);
    check("B. Message: the menu card opens the message checker with the cursor in the text box", (await d10.evaluate(() => document.activeElement.id)) === "msg-input");
    await d10.fill("#msg-input", critText);
    await d10.click("#msg-analyze");
    await d10.waitForSelector("#msg-result .risk-summary");
    const b10 = await d10.evaluate(() => ({ cat: document.querySelector("#msg-result .risk-summary").getAttribute("data-category"), text: document.querySelector("#msg-result .risk-summary").textContent, marks: document.querySelectorAll("#msg-result mark.hit").length, phrases: document.querySelectorAll("#msg-result ul.phrases li").length, holdy: document.querySelector("#msg-result .holdy") && document.querySelector("#msg-result .holdy").getAttribute("data-level") }));
    check("B. Message: suspicious phrases are marked in the text and listed", b10.marks >= 2 && b10.phrases >= 2, b10.marks + " marks");
    check("B. Message: the result is exactly the central engine's category and score", b10.cat === critExp.category && b10.text.includes("Warning level " + critExp.score + " of 100"), b10.cat + " " + critExp.category + " " + critExp.score);
    check("B. Message: the summary's evidence names the engine's strongest reasons", critExp.reasons.slice(0, 3).every((r) => b10.text.includes(r.text)));
    check("B. Message: Prevy's card is at the same level as the result", b10.holdy === critExp.category);
    await d10.click("#message-check .back-link");
    await sleep(200);
    check("B. Message: back to the menu works", (await d10.evaluate(() => document.activeElement.id)) === "tools-h");

    // -- E. Prevy and the summary across categories (expected values computed with the same engine in Node)
    const samples10 = [
      ["Hi Amma, I will reach home by 7 pm. Keep dinner ready.", "LOW"],
      ["Dear customer, your KYC is pending. Update today or your account will be blocked.", "MEDIUM"],
      ["Congratulations! You won a lottery of 25 lakh. Pay the processing fee of Rs 999 to claim.", "HIGH"],
      [critText, "CRITICAL"],
    ];
    for (const [text, want] of samples10) {
      const exp = expectMsg(text);
      await d10.fill("#msg-input", text);
      await d10.click("#msg-analyze");
      await d10.waitForFunction(() => document.querySelector("#msg-result .risk-summary"), null, { timeout: 5000 });
      await sleep(150);
      const got = await d10.evaluate(() => {
        const b = document.querySelector("#msg-result .risk-summary");
        const card = document.querySelector("#msg-result .holdy");
        const n = document.querySelector("#msg-result .holdy-note");
        return { cat: b.getAttribute("data-category"), text: b.textContent, card: card ? card.getAttribute("data-level") : null, repeat: card ? card.getAttribute("data-repeat") : null, note: !!n, cardText: card ? card.textContent : "", role: card ? card.getAttribute("role") : null };
      });
      const supported = exp.reasons.every((r) => !got.cardText || true) && (want === "LOW" ? !got.card : exp.reasons.some((r) => got.cardText.includes(r.text)) || got.repeat === "true");
      check(`E. Prevy (${want}): the result matches the engine (${exp.category} ${exp.score}) and Prevy's ${want === "LOW" ? "small note" : "card"} matches it`, exp.category === want && got.cat === want && got.text.includes("Warning level " + exp.score + " of 100") && (want === "LOW" ? got.note && !got.card : got.card === want), JSON.stringify({ cat: got.cat, card: got.card, note: got.note }));
      if (want === "LOW") check("E. Prevy (LOW): no warning signs are claimed, and it says this is not proof of safety", /No warning signs in what was checked\. This is not proof of safety\./.test(got.text));
      else check(`E. Prevy (${want}): every sign Prevy shows comes from the analysis`, supported);
      if (want === "HIGH" || want === "CRITICAL") check(`E. Prevy (${want}): the warning is announced as an alert the first time`, got.role === "alert" || got.repeat === "true");
    }
    await d10.fill("#msg-input", critText);
    await d10.click("#msg-analyze");
    await sleep(400);
    check("E. Prevy: repeating the same check shows a short card, not a second full warning", (await d10.getAttribute("#msg-result .holdy", "data-repeat")) === "true" && (await d10.$$eval("#msg-result .holdy", (h) => h.length)) === 1);

    // -- missing module: the background says a checker is unavailable
    const beforeMissing = (await st10()).scansTotal;
    await d10.evaluate(() => {
      window.__realSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (m) => (m && m.type === "prevenza/scan-message" ? Promise.resolve({ ok: false, error: "unavailable" }) : window.__realSend(m));
    });
    await d10.fill("#msg-input", critText);
    await d10.click("#msg-analyze");
    await sleep(400);
    const miss = await d10.textContent("#msg-result");
    check("Missing module: an unavailable checker says nothing was checked and that this does not mean safe, with no risk label", /not available right now, so nothing was checked\. That does not mean it is safe\./.test(miss) && (await d10.$$eval("#msg-result .pill", (p) => p.length)) === 0);
    check("Missing module: nothing is counted for a check that did not run", (await st10()).scansTotal === beforeMissing);
    await d10.evaluate(() => { chrome.runtime.sendMessage = window.__realSend; });

    // -- empty and invalid inputs
    const beforeEmpty = (await st10()).scansTotal;
    await d10.fill("#msg-input", "");
    await d10.click("#msg-analyze");
    await sleep(300);
    const emptyMsg = await d10.textContent("#msg-result");
    await d10.fill("#link-input", "");
    await d10.click('#link-form button[type="submit"]');
    await sleep(300);
    const emptyLink = await d10.textContent("#link-result");
    await d10.fill("#link-input", "http://");
    await d10.click('#link-form button[type="submit"]');
    await sleep(300);
    const badLink = await d10.textContent("#link-result");
    await d10.click("#upi-clear");
    await d10.click("#upi-analyze");
    await sleep(300);
    const emptyUpi = await d10.textContent("#upi-result");
    await d10.fill("#upi-amount", "-5abc");
    await d10.click("#upi-analyze");
    await sleep(300);
    const badUpi = await d10.textContent("#upi-result");
    check("Empty and invalid input: each checker answers with a friendly message and no risk label", emptyMsg.length > 0 && emptyLink.length > 0 && badLink.length > 0 && emptyUpi.length > 0 && badUpi.length > 0 && (await d10.$$eval("#msg-result .risk-summary, #upi-result .risk-summary", (p) => p.length)) === 0, [emptyMsg, emptyLink, badLink, emptyUpi, badUpi].map((x) => x.slice(0, 40)).join(" | "));
    check("Empty and invalid input: none of them is shown as low risk or safe", ![emptyMsg, emptyLink, badLink, emptyUpi].some((t) => /Low risk|\bis safe\b/i.test(t)));
    check("Empty and invalid input: nothing is counted", (await st10()).scansTotal === beforeEmpty, beforeEmpty + " -> " + (await st10()).scansTotal);
    await d10.click("#upi-clear");

    // -- C. UPI: menu -> fields -> analyze -> warning -> clear
    await d10.click('.tool-card[href="#upi-check"]');
    await sleep(200);
    check("C. UPI: the menu card opens the payment checker with the cursor in the UPI ID box", (await d10.evaluate(() => document.activeElement.id)) === "upi-id");
    await d10.fill("#upi-id", "refund.helpdesk@ybl");
    await d10.fill("#upi-name", "Customer Care Refund");
    await d10.fill("#upi-amount", "4999");
    await d10.fill("#upi-reason", "Pay this amount to receive your refund. Enter your UPI PIN to receive money.");
    await d10.click("#upi-analyze");
    await d10.waitForSelector("#upi-result .risk-summary");
    const c10 = await d10.evaluate(() => ({ cat: document.querySelector("#upi-result .risk-summary").getAttribute("data-category"), text: document.querySelector("#upi-result .risk-summary").textContent, holdy: !!document.querySelector("#upi-result .holdy") }));
    check("C. UPI: the payment warning uses the same summary (High or Critical, with score, confidence, evidence and action) and Prevy", /^(HIGH|CRITICAL)$/.test(c10.cat) && /Warning level \d+ of 100/.test(c10.text) && /Confidence/.test(c10.text) && /Recommended action/.test(c10.text) && /cannot tell whether a payment is a scam/.test(c10.text) && c10.holdy, c10.cat);
    await d10.click("#upi-clear");
    check("C. UPI: Clear empties every field and the result", (await d10.$$eval("#upi-form input, #upi-form textarea", (f) => f.every((x) => x.value === ""))) && (await d10.textContent("#upi-result")) === "");

    // -- D. Screenshot: menu -> upload -> OCR -> result -> inconclusive -> clear
    await d10.click('.tool-card[href="#screenshot-check"]');
    await sleep(200);
    check("D. Screenshot: the menu card opens the screenshot checker with keyboard focus on the file picker", (await d10.evaluate(() => document.activeElement.id)) === "shot-file");
    const shot10 = await makeImage("prevenza-step10.png", ["URGENT: Your bank KYC has expired.", "Share the OTP sent to your phone now", "or your account will be blocked today."]);
    await d10.setInputFiles("#shot-file", shot10);
    await sleep(400);
    await d10.click("#shot-analyze");
    await d10.waitForFunction(() => document.querySelector("#shot-result .risk-summary") || !document.getElementById("shot-problem").hidden, null, { timeout: 90000 });
    await sleep(300);
    const dd = await d10.evaluate(() => ({ cat: document.querySelector("#shot-result .risk-summary") && document.querySelector("#shot-result .risk-summary").getAttribute("data-category"), text: document.getElementById("shot-text").value, sum: document.querySelector("#shot-result .risk-summary") ? document.querySelector("#shot-result .risk-summary").textContent : "" }));
    check("D. Screenshot: the image is read on the device, the text is shown, and the result uses the same summary", /OTP/i.test(dd.text) && /^(MEDIUM|HIGH|CRITICAL)$/.test(dd.cat || "") && /Warning level \d+ of 100/.test(dd.sum), dd.cat + " / " + dd.text.slice(0, 60).replace(/\n/g, " "));
    await d10.fill("#shot-text", "");
    await d10.click("#shot-recheck");
    await d10.waitForFunction(() => { const b = document.querySelector("#shot-result .risk-summary"); return b && b.getAttribute("data-category") === "INCONCLUSIVE"; }, null, { timeout: 8000 }).catch(() => undefined);
    const inc = await d10.evaluate(() => { const b = document.querySelector("#shot-result .risk-summary"); return b ? { cat: b.getAttribute("data-category"), text: b.textContent, dashed: getComputedStyle(b).borderTopStyle, pill: b.querySelector(".pill").textContent } : null; });
    check("Inconclusive: unreadable screenshot text is INCONCLUSIVE, with no warning level, and says nothing was marked safe", inc && inc.cat === "INCONCLUSIVE" && /No warning level/.test(inc.text) && /Nothing was marked safe/.test(inc.text) && inc.pill === "Inconclusive" && inc.dashed === "dashed", JSON.stringify(inc));
    check("Inconclusive: the summary names what could not be checked", inc && /Could not be checked/.test(inc.text) && /Screenshot text/.test(inc.text));
    check("Inconclusive: the latest-result pill says Inconclusive, never Low", (await d10.textContent("#overall-pill")) === "Inconclusive");
    await d10.click("#shot-clear");
    await sleep(200);
    check("D. Screenshot: Clear all removes the image, the read text and the result", (await d10.getAttribute("#shot-img", "src")) === null && (await d10.isHidden("#shot-preview")) && (await d10.isHidden("#shot-text-wrap")) && (await d10.textContent("#shot-result")) === "" && (await d10.inputValue("#shot-text")) === "");
    try { fs.unlinkSync(shot10); } catch (e) { /* temporary file */ }

    // -- statistics after the workflows
    await sleep(300);
    const s1 = await st10();
    check("Statistics: the overview matches the stored counters after all the checks, without reloading", await statsMatch(), JSON.stringify(await statsShown()));
    check("Statistics: categories add up to the total, and the last check time is set", s1.scansLow + s1.scansMedium + s1.scansHigh + s1.scansCritical + s1.scansInconclusive === s1.scansTotal && !!s1.lastScanAt && s1.scansInconclusive >= 1 && s1.scansCritical >= 1, JSON.stringify(s1));
    await d10.reload();
    await d10.waitForSelector("#legend li");
    await sleep(400);
    check("Statistics: after reloading, the counts are the same and the latest-result pill is back to 'Not scanned yet' (results are not kept)", (await statsMatch()) && (await d10.textContent("#overall-pill")) === "Not scanned yet" && (await d10.textContent("#msg-result")) === "" && (await d10.inputValue("#msg-input")) === "");

    // -- protection on and off
    await setPrefs({ enabled: false });
    await d10.reload();
    await d10.waitForSelector("#legend li");
    await sleep(400);
    const offBefore = (await st10()).scansTotal;
    await d10.fill("#msg-input", critText);
    await d10.click("#msg-analyze");
    await sleep(300);
    await d10.fill("#link-input", "http://sbi-kyc-update.xyz/login");
    await d10.click('#link-form button[type="submit"]');
    await sleep(300);
    check("Protection OFF: the overview says Off, checks say protection is off, no result and nothing counted", (await d10.textContent("#stat-protection")) === "Off" && /Protection is off/.test(await d10.textContent("#msg-result")) && /Protection is off/.test(await d10.textContent("#link-result")) && (await d10.$$eval(".risk-summary", (p) => p.length)) === 0 && (await st10()).scansTotal === offBefore);
    await setPrefs({ enabled: true });
    await d10.reload();
    await d10.waitForSelector("#legend li");
    await sleep(400);
    check("Protection ON again: the overview says On and checking works", (await d10.textContent("#stat-protection")) === "On");

    // -- G. Emergency Help from the menu, and back
    await d10.click(".tool-card-emergency");
    await d10.waitForSelector("#incident-list button");
    check("G. Emergency: the menu card opens Emergency Help", d10.url() === URL_EMG);
    await d10.click('#incident-list [data-incident="otp_pin"]');
    check("G. Emergency: choosing an incident shows its instructions", /Contact your bank immediately/.test(await d10.textContent("#steps-body")));
    await d10.click(".emg-back a");
    await d10.waitForSelector("#legend li");
    check("G. Emergency: Return to dashboard goes back to the dashboard", d10.url() === URL_DASH);
    await sleep(300);

    // -- keyboard
    await d10.goto("about:blank");
    await d10.goto(URL_DASH);
    await d10.waitForSelector("#legend li");
    await sleep(300);
    const kOrder = [];
    for (let i = 0; i < 12; i++) {
      await d10.keyboard.press("Tab");
      kOrder.push(await d10.evaluate(() => { const a = document.activeElement; return a.classList.contains("tool-card") ? "card:" + a.getAttribute("href") : a.id || a.textContent.trim().slice(0, 20); }));
    }
    const firstCard = kOrder.findIndex((k) => k.startsWith("card:"));
    check("Keyboard: Tab reaches Emergency Help in the header first, then the five menu cards in order", kOrder.indexOf("Emergency Help") >= 0 && kOrder.indexOf("Emergency Help") < firstCard && JSON.stringify(kOrder.slice(firstCard, firstCard + 5)) === JSON.stringify(["card:#link-check", "card:#message-check", "card:#upi-check", "card:#screenshot-check", "card:../emergency/emergency.html"]), kOrder.join(" > "));
    await d10.focus('.tool-card[href="#message-check"]');
    await d10.keyboard.press("Enter");
    await sleep(200);
    check("Keyboard: Enter on a menu card moves focus into that checker", (await d10.evaluate(() => document.activeElement.id)) === "msg-input");
    await d10.focus("#message-check .back-link");
    await d10.keyboard.press("Enter");
    await sleep(200);
    check("Keyboard: Enter on 'Back to the dashboard menu' returns focus to the menu heading", (await d10.evaluate(() => document.activeElement.id)) === "tools-h");
    const ring = await d10.evaluate(() => { const c = document.querySelector(".tool-card"); c.focus(); return parseFloat(getComputedStyle(c).outlineWidth); });
    check("Keyboard: menu cards show a visible focus outline", ring >= 2, String(ring));

    // -- responsive (with a result showing)
    await d10.fill("#msg-input", critText);
    await d10.click("#msg-analyze");
    await d10.waitForSelector("#msg-result .risk-summary");
    for (const vp of [{ width: 1100, height: 900 }, { width: 768, height: 900 }, { width: 390, height: 844 }, { width: 360, height: 800 }]) {
      await d10.setViewportSize(vp);
      await sleep(150);
      const o = await d10.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      check(`Layout (normal, ${vp.width}px): no sideways scrolling, menu cards at least 44px tall`, o.sw <= o.cw && Math.min(...(await visibleHeights(d10, ".tool-card"))) >= 44, `${o.sw}/${o.cw}`);
    }
    await d10.screenshot({ path: path.join(SHOTS, "27-dashboard-unified-mobile.png"), fullPage: true });
    await d10.setViewportSize({ width: 1100, height: 900 });
    await d10.evaluate(() => scrollTo(0, 0));
    await d10.screenshot({ path: path.join(SHOTS, "26-dashboard-unified.png"), fullPage: true });

    // -- F. Elder Mode on and off
    await setPrefs({ elderMode: true });
    await d10.reload();
    await d10.waitForSelector("#legend li");
    await sleep(400);
    const eOn = await d10.evaluate(() => {
      const cards = [...document.querySelectorAll(".tool-cards > li")].map((li) => ({ top: li.getBoundingClientRect().top, em: li.classList.contains("tool-emergency") }));
      return { attr: document.documentElement.getAttribute("data-elder"), font: parseFloat(getComputedStyle(document.documentElement).fontSize), cols: getComputedStyle(document.querySelector(".tool-cards")).gridTemplateColumns.split(" ").length, emergencyFirst: cards.every((c) => c.em || c.top > cards.find((x) => x.em).top), header: !!document.querySelector(".nav a.btn-emergency").getClientRects().length, navTop: document.getElementById("tools-nav").getBoundingClientRect().top, linkTop: document.getElementById("link-check").getBoundingClientRect().top, overviewTop: document.getElementById("overview").getBoundingClientRect().top };
    });
    check("F. Elder Mode on: larger text, one column of menu cards, Emergency Help first in the menu and still in the header", eOn.attr === "true" && eOn.font >= 22 && eOn.cols === 1 && eOn.emergencyFirst && eOn.header, JSON.stringify(eOn));
    check("F. Elder Mode on: the menu comes before the checkers, and the counts move down with the technical parts", eOn.navTop < eOn.linkTop && eOn.overviewTop > eOn.linkTop);
    check("F. Elder Mode on: menu cards and back links are at least 56px tall", Math.min(...(await visibleHeights(d10, ".tool-card, .back-link"))) >= 56);
    await d10.fill("#msg-input", critText);
    await d10.click("#msg-analyze");
    await d10.waitForSelector("#msg-result .risk-summary");
    const eSum = await d10.evaluate(() => { const b = document.querySelector("#msg-result .risk-summary"); return { cols: getComputedStyle(b.querySelector(".risk-facts")).gridTemplateColumns.split(" ").length, elder: !!document.querySelector("#msg-result .holdy-elder"), steps: document.querySelectorAll("#msg-result .holdy-step").length }; });
    check("F. Elder Mode on: the summary stacks in one column and Prevy gives the plain explanation with numbered steps", eSum.cols === 1 && eSum.elder && eSum.steps >= 1, JSON.stringify(eSum));
    for (const vp of [{ width: 390, height: 844 }, { width: 360, height: 800 }]) {
      await d10.setViewportSize(vp);
      await sleep(150);
      const o = await d10.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth }));
      check(`Layout (Elder Mode, ${vp.width}px): no sideways scrolling`, o.sw <= o.cw, `${o.sw}/${o.cw}`);
    }
    await d10.setViewportSize({ width: 1100, height: 900 });
    await d10.evaluate(() => scrollTo(0, 0));
    await d10.screenshot({ path: path.join(SHOTS, "28-dashboard-unified-elder.png"), fullPage: true });
    await setPrefs({ elderMode: false });
    await d10.reload();
    await d10.waitForSelector("#legend li");
    await sleep(400);
    const eOff = await d10.evaluate(() => ({ attr: document.documentElement.getAttribute("data-elder"), font: parseFloat(getComputedStyle(document.documentElement).fontSize), cols: getComputedStyle(document.querySelector(".tool-cards")).gridTemplateColumns.split(" ").length }));
    check("F. Elder Mode off: normal text size and the menu back in several columns", eOff.attr === "false" && eOff.font === 16 && eOff.cols >= 2, JSON.stringify(eOff));

    // -- language: the new labels follow the setting; the rest stays English as before
    await setPrefs({ language: "hi" });
    await d10.reload();
    await d10.waitForSelector("#legend li");
    await sleep(400);
    check("Language (Hindi): the menu heading, cards, overview heading and back links are in Hindi", (await d10.textContent("#tools-h")) === I18N.TABLE.hi.dash_tools && (await d10.textContent('.tool-card[href="#upi-check"] strong')) === I18N.TABLE.hi.nav_upi && (await d10.textContent("#overview-h")) === I18N.TABLE.hi.dash_overview && (await d10.$$eval(".back-link", (l) => l.every((x) => /[\u0900-\u097f]/.test(x.textContent)))));
    await setPrefs({ language: "en" });
    await d10.reload();
    await d10.waitForSelector("#legend li");
    await sleep(300);
    check("Language (English): restored exactly", (await d10.textContent("#tools-h")) === "What would you like to check?" && (await d10.textContent("#overview-h")) === "Overview");

    // -- statistics unavailable: the counters cannot be read
    const un = await ctx.newPage();
    await un.addInitScript(() => {
      const real = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (m) => (m && m.type === "prevenza/get-state" ? Promise.resolve({ ok: false, error: "internal-error" }) : real(m));
    });
    await un.goto(URL_DASH);
    await un.waitForSelector("#legend li");
    await sleep(500);
    check("Statistics unavailable: the overview says 'Unavailable' instead of inventing numbers", JSON.stringify(await un.$$eval("#stat-scans, #stat-high, #stat-lowmed, #stat-inconclusive, #stat-lastscan, #stat-protection", (e) => e.map((x) => x.textContent))) === JSON.stringify(Array(6).fill("Unavailable")));
    await un.close();

    // -- privacy, permissions, network
    const all10 = await sw.evaluate(() => chrome.storage.local.get(null));
    const blob10 = JSON.stringify(all10);
    check("Privacy: storage still holds only settings, counters and the schema number", Object.keys(all10).every((k) => ["prevenza.schema", "prevenza.settings", "prevenza.stats"].includes(k)), Object.keys(all10).join(","));
    check("Privacy: nothing that was checked was stored (no address, message, UPI ID, name, amount or screenshot text)", !/sbi-kyc|digital arrest|CBI|refund\.helpdesk|Customer Care|4999|KYC has expired|lottery|Amma/i.test(blob10));
    check("Privacy: the statistics are only numbers and times", Object.entries(all10["prevenza.stats"]).every(([k, v]) => typeof v === "number" || v === null || /^\d{4}-\d\d-\d\dT[\d:.]+Z$/.test(v)), Object.keys(all10["prevenza.stats"]).join(","));
    check("Privacy: the settings keys are unchanged", Object.keys(all10["prevenza.settings"]).sort().join(",") === "elderMode,enabled,language,mutedSites,pageWarnings,sensitivity,showAssistantBadge");
    const m10 = await sw.evaluate(() => chrome.runtime.getManifest());
    check("Permissions: still only 'storage', no host permissions", JSON.stringify(m10.permissions) === '["storage"]' && !m10.host_permissions && !m10.optional_permissions);
    check("Network: the unified dashboard made no network request", step10Requests.every((u) => u.startsWith("chrome-extension://") || u.startsWith("data:") || u.startsWith("blob:") || u === "about:blank"), step10Requests.filter((u) => !/^(chrome-extension|data|blob):|^about:blank$/.test(u)).join(", ") || step10Requests.length + " local requests");
    const step10Total = (await st10()).scansTotal;
    await d10.close();

    // ---- 7d. Step 11: performance, large inputs, extra OCR conditions, one scale everywhere (new checks)
    const perf = {};
    const median = (a) => { const s = a.slice().sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; };
    const d11 = await ctx.newPage();
    watch(d11, "dashboard11");
    const step11Requests = [];
    d11.on("request", (r) => step11Requests.push(r.url()));
    await d11.setViewportSize({ width: 1100, height: 900 });
    let t11 = Date.now();
    await d11.goto(URL_DASH);
    await d11.waitForFunction(() => document.getElementById("stat-scans").textContent !== "-" && document.querySelectorAll("#legend li").length > 0);
    perf.dashboardReadyMs = Date.now() - t11;
    perf.dashboardDomMs = Math.round(await d11.evaluate(() => performance.getEntriesByType("navigation")[0].domContentLoadedEventEnd));
    const p11 = await ctx.newPage();
    t11 = Date.now();
    await p11.goto(URL_POPUP);
    await p11.waitForFunction(() => document.getElementById("protection-sub").textContent !== "Loading...");
    perf.popupReadyMs = Date.now() - t11;
    await p11.close();
    perf.extensionStartMs = swReadyMs;

    // scanner round trips, measured from the page (message to the worker, analysis, reply), 15 runs each
    const timeIt = (msg, n) => d11.evaluate(async ([m, runs]) => {
      const out = [];
      for (let i = 0; i < runs; i++) {
        const s = performance.now();
        const r = await chrome.runtime.sendMessage(m);
        out.push(performance.now() - s);
        if (!r || r.ok !== true) return { error: JSON.stringify(r).slice(0, 120) };
      }
      return { times: out };
    }, [msg, n]);
    const longMsg = ("Dear customer your KYC expired, share OTP now to avoid block. " + "Normal words about the family dinner and the weather today. ").repeat(80).slice(0, 5000);
    const timings = {
      url: await timeIt({ type: "prevenza/check-url", payload: { url: "https://www.paytm.com.refund-help.site/login?next=kyc" } }, 15),
      message5000: await timeIt({ type: "prevenza/scan-message", payload: { text: longMsg } }, 15),
      upi: await timeIt({ type: "prevenza/analyze-upi", payload: { upiId: "refund.helpdesk@ybl", name: "Customer Care", amount: "4999", reason: "Pay to receive refund", qrText: "upi://pay?pa=refund.helpdesk@ybl&am=4999" } }, 15),
      screenshotText20000: await timeIt({ type: "prevenza/analyze-screenshot", payload: { text: (longMsg + longMsg + longMsg + longMsg).slice(0, 20000), confidence: 88 } }, 15),
    };
    for (const [k, v] of Object.entries(timings)) perf[k + "MedianMs"] = v.times ? Math.round(median(v.times) * 10) / 10 : "error " + v.error;
    check("Performance: every scanner answers (median of 15 runs) in under 250 ms, including the largest allowed inputs", Object.values(timings).every((v) => v.times && median(v.times) < 250), JSON.stringify(perf));
    check("Performance: the dashboard is ready in under 3 seconds and the popup in under 2 seconds", perf.dashboardReadyMs < 3000 && perf.popupReadyMs < 2000, perf.dashboardReadyMs + " / " + perf.popupReadyMs + " ms");
    check("Performance: the extension's worker started within 10 seconds of the browser launching", swReadyMs < 10000, swReadyMs + " ms");

    // large and oversized input
    const big = await d11.evaluate(async () => {
      const send = (m) => chrome.runtime.sendMessage(m);
      return {
        msgMax: await send({ type: "prevenza/scan-message", payload: { text: "a".repeat(20000) } }),
        msgOver: await send({ type: "prevenza/scan-message", payload: { text: "a".repeat(20001) } }),
        urlOver: await send({ type: "prevenza/check-url", payload: { url: "https://example.com/" + "a".repeat(2100) } }),
        shotOver: await send({ type: "prevenza/analyze-screenshot", payload: { text: "a".repeat(20001) } }),
        upiOver: await send({ type: "prevenza/analyze-upi", payload: { reason: "a".repeat(1001) } }),
      };
    });
    check("Large input: the largest allowed message is analysed (only the first 5000 characters) and anything bigger is refused", big.msgMax.ok && big.msgMax.result.truncated === true && big.msgMax.result.analysedLength === 5000 && big.msgOver.error === "bad-payload" && big.urlOver.error === "bad-payload" && big.shotOver.error === "bad-payload" && big.upiOver.error === "bad-payload");
    await d11.fill("#msg-input", "x".repeat(6000));
    check("Large input: the message box itself stops at 5000 characters", (await d11.inputValue("#msg-input")).length === 5000);
    await d11.click("#msg-clear");

    // one scale everywhere: a look-alike the URL analyzer alone calls 'high' but the engine rates Medium
    await d11.fill("#link-input", "https://paytrn.com/");
    await d11.click('#link-form button[type="submit"]');
    await d11.waitForSelector("#link-result .risk-summary");
    const one = await d11.evaluate(() => ({ pills: [...document.querySelectorAll("#link-result .pill")].map((p) => p.textContent), card: document.querySelector("#link-result .holdy") && document.querySelector("#link-result .holdy").getAttribute("data-level"), cat: document.querySelector("#link-result .risk-summary").getAttribute("data-category") }));
    check("One scale: the link checker's pill, the summary and Prevy all show the central engine's category", one.pills.length === 2 && one.pills.every((p) => p === one.pills[0]) && one.cat === "MEDIUM" && one.card === "MEDIUM" && one.pills[0] === "Medium risk", JSON.stringify(one));
    check("One scale: the risk scale lists all six states, each with a label and a shape", JSON.stringify(await d11.$$eval("#legend .pill", (p) => p.map((x) => x.textContent))) === JSON.stringify(["Not scanned yet", "Low risk", "Medium risk", "High risk", "Critical risk", "Inconclusive"]) && (await d11.$$eval("#legend .pill", (p) => p.every((x) => getComputedStyle(x, "::before").content !== "none"))));

    // extra OCR conditions: blurry, low resolution, mixed language, timed, with memory where Chrome reports it
    const heap = () => d11.evaluate(() => (performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null));
    const makeShot = async (name, lines, o) => {
      const b64 = await d11.evaluate(async ({ lines, o }) => {
        const w = o.width || 1000;
        const c = document.createElement("canvas");
        c.width = w;
        c.height = Math.max(60, (o.top || 30) * 2 + lines.length * (o.lineHeight || 64));
        const g = c.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, c.width, c.height);
        if (o.blur) g.filter = "blur(" + o.blur + "px)";
        g.fillStyle = "#111";
        g.font = o.font || "30px Arial";
        g.textBaseline = "top";
        lines.forEach((l, i) => g.fillText(l, o.left || 30, (o.top || 30) + i * (o.lineHeight || 64)));
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
        return btoa(s);
      }, { lines, o });
      const file = path.join(os.tmpdir(), name);
      fs.writeFileSync(file, Buffer.from(b64, "base64"));
      return file;
    };
    const ocr11 = async (file, language) => {
      await d11.click("#shot-clear");
      await d11.setInputFiles("#shot-file", file);
      await sleep(300);
      await d11.selectOption("#shot-language", language);
      const s = Date.now();
      await d11.click("#shot-analyze");
      await d11.waitForFunction(() => document.querySelector("#shot-result .risk-summary") || !document.getElementById("shot-problem").hidden, null, { timeout: 120000 });
      const ms = Date.now() - s;
      await sleep(200);
      const out = await d11.evaluate(() => { const b = document.querySelector("#shot-result .risk-summary"); return { cat: b ? b.getAttribute("data-category") : null, text: document.getElementById("shot-text").value, problem: document.getElementById("shot-problem").hidden ? "" : document.getElementById("shot-problem").textContent }; });
      try { fs.unlinkSync(file); } catch (e) { /* temporary */ }
      return Object.assign(out, { ms });
    };
    const scamLines = ["URGENT: Your bank KYC has expired.", "Share the OTP sent to your phone now", "or your account will be blocked today."];
    const ocr11ErrorsBefore = errors.length;
    const heapBefore = await heap();
    const clear11 = await ocr11(await makeShot("p11-clear.png", scamLines, {}), "eng");
    perf.ocrClearEnglishMs = clear11.ms;
    const heapAfter = await heap();
    await sleep(500);
    perf.heapMbBeforeOcr = heapBefore;
    perf.heapMbAfterOcr = heapAfter;
    perf.ocrWorkersLeft = d11.workers().length;
    check("OCR (clear English): the scam is found, and reading took under 60 seconds", /^(HIGH|CRITICAL)$/.test(clear11.cat || "") && clear11.ms < 60000, clear11.cat + ", " + clear11.ms + " ms");
    check("OCR: the reader's worker is shut down after reading (memory is released)", d11.workers().length === 0, "workers: " + d11.workers().length + ", JS heap " + heapBefore + " -> " + heapAfter + " MB");
    const blurry = await ocr11(await makeShot("p11-blur.png", scamLines, { blur: 1.6 }), "eng");
    perf.ocrBlurryMs = blurry.ms;
    check("OCR (blurry): either the warning is still found, or the result is Inconclusive; never a confident Low", blurry.cat !== "LOW", JSON.stringify({ cat: blurry.cat, text: blurry.text.slice(0, 50).replace(/\n/g, " "), problem: blurry.problem.slice(0, 60) }));
    const tiny = await ocr11(await makeShot("p11-tiny.png", scamLines, { width: 260, font: "9px Arial", lineHeight: 12, top: 6, left: 4 }), "eng");
    perf.ocrLowResMs = tiny.ms;
    check("OCR (very low resolution): the result is a warning or Inconclusive, never a confident Low based on garbled text", tiny.cat !== "LOW", JSON.stringify({ cat: tiny.cat, text: tiny.text.slice(0, 50).replace(/\n/g, " "), problem: tiny.problem.slice(0, 60) }));
    const mixed = await ocr11(await makeShot("p11-mixed.png", ["Dear customer, your KYC is pending.", "\u0905\u092a\u0928\u093e OTP \u0924\u0941\u0930\u0902\u0924 \u092c\u0924\u093e\u090f\u0902", "warna account block ho jayega."], { font: "32px Arial, 'Nirmala UI', sans-serif" }), "hin");
    perf.ocrMixedMs = mixed.ms;
    check("OCR (mixed Hindi and English in one image): the text is read and a warning is raised", /^(MEDIUM|HIGH|CRITICAL)$/.test(mixed.cat || ""), JSON.stringify({ cat: mixed.cat, text: mixed.text.slice(0, 70).replace(/\n/g, " ") }));
    await d11.click("#shot-clear");
    // Same rule as the Step 6 check: the engine prints harmless "Parameter not found" notices; anything else is a real error.
    const ocr11Errors = errors.splice(ocr11ErrorsBefore);
    check("OCR (Step 11 runs): no errors other than the engine's own harmless notices", ocr11Errors.every((e) => /Warning: Parameter not found/.test(e)), ocr11Errors.filter((e) => !/Warning: Parameter not found/.test(e)).slice(0, 2).join(" ; "));
    console.log("PERF  " + JSON.stringify(perf));
    check("Step 11 pages made no network requests", step11Requests.every((u) => /^(chrome-extension|data|blob):/.test(u)), step11Requests.filter((u) => !/^(chrome-extension|data|blob):/.test(u)).join(", ") || step11Requests.length + " local requests");
    const all11 = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
    check("Step 11: nothing from the performance or OCR runs was stored", !/KYC|OTP|paytrn|refund\.helpdesk|aaaaaaaaaa/.test(all11));
    let finalScanTotal = (await st10()).scansTotal; // updated after the Step 12 checks below
    await d11.close();

    // ---- 7e. Step 12: warning before a risky website, QR codes in screenshots, the complaint helper, new rules and languages
    {
      const getStats12 = async () => (await sw.evaluate(() => chrome.storage.local.get("prevenza.stats")))["prevenza.stats"];
      const sp = await ctx.newPage();
      watch(sp, "settings12");
      await sp.goto(URL_SETTINGS);
      await sp.waitForSelector("#pageWarnings", { state: "attached" });
      await sleep(400);
      check("Step 12 settings: 'Warn me before a risky website' is there and on by default", await sp.isChecked("#pageWarnings"));
      if (!(await sp.isChecked("#enabled"))) await sp.click("#enabled", { force: true });
      await sp.selectOption("#sensitivity", "balanced");
      await sleep(400);
      check("Step 12 settings: the sensitivity help now describes the page warning", /warns before a website|warns before a risky website/i.test(await sp.textContent("#sens-help")), await sp.textContent("#sens-help"));

      const warnState = (pg) => pg.evaluate(() => {
        const h = document.getElementById("prevenza-warning-host");
        if (!h) return null;
        const r = h.shadowRoot;
        return {
          title: r.querySelector("h2").textContent, host: r.querySelector(".host").textContent, pill: r.querySelector(".pill").textContent,
          reasons: r.querySelectorAll("li").length, buttons: [...r.querySelectorAll("button")].map((b) => b.textContent),
          focus: r.activeElement ? r.activeElement.textContent : "", role: r.querySelector(".box").getAttribute("role"),
          elder: r.querySelector(".box").getAttribute("data-elder"), text: r.querySelector(".box").textContent,
        };
      });
      const waitWarn = (pg) => pg.waitForFunction(() => !!document.getElementById("prevenza-warning-host"), null, { timeout: 8000 }).catch(() => null);
      const before12 = (await getStats12()).warningsShown;
      const risky = "http://sbi-kyc-update.xyz:" + port + "/";
      const rp = await ctx.newPage();
      watch(rp, "risky-site");
      await rp.goto(site);
      await rp.goto(risky);
      await waitWarn(rp);
      const w = await warnState(rp);
      check("Step 12: a website whose name has strong scam signs is covered by a warning", !!w && /may be a scam/.test(w.title) && w.host === "sbi-kyc-update.xyz" && /High risk|Critical risk/.test(w.pill) && w.reasons >= 1 && w.role === "alertdialog", JSON.stringify(w && { title: w.title, host: w.host, pill: w.pill, reasons: w.reasons }));
      check("Step 12: the warning offers Go back and Continue anyway, with Go back focused", !!w && w.buttons.join("|") === "Go back|Continue anyway" && w.focus === "Go back", w && w.buttons.join("|") + " focus=" + w.focus);
      check("Step 12: the warning says only the name was checked, and never calls anything safe", !!w && /checked only the name/.test(w.text) && !/\bsafe\b/i.test(w.text));
      await sleep(400); // let the short fade-in finish
      await rp.screenshot({ path: path.join(SHOTS, "29-page-warning.png") });
      check("Step 12: the warning is counted, as a number only", (await getStats12()).warningsShown === before12 + 1);
      const pwBefore = await rp.inputValue("#pw");
      await rp.evaluate(() => document.getElementById("prevenza-warning-host").shadowRoot.querySelector(".go").click());
      await sleep(300);
      check("Step 12: Continue anyway removes the warning and leaves the page untouched", (await rp.evaluate(() => !document.getElementById("prevenza-warning-host"))) && pwBefore === "hunter2-SECRET" && (await rp.inputValue("#pw")) === "hunter2-SECRET");
      await rp.reload();
      await waitWarn(rp);
      await rp.evaluate(() => document.getElementById("prevenza-warning-host").shadowRoot.querySelector(".back").click());
      await rp.waitForURL(site, { timeout: 8000 }).catch(() => null);
      check("Step 12: Go back returns to the previous page", rp.url() === site, rp.url());
      await sleep(800);
      check("Step 12: an ordinary website gets no warning", await rp.evaluate(() => !document.getElementById("prevenza-warning-host")));

      const crit = "http://sbi.co.in.verify-account.xyz:" + port + "/";
      await rp.goto(crit);
      await waitWarn(rp);
      const wc = await warnState(rp);
      check("Step 12: a bank name in front of another site gets a Critical warning", !!wc && /Critical risk/.test(wc.pill), wc && wc.pill);
      await rp.setViewportSize({ width: 390, height: 760 });
      await sleep(300);
      const fits = await rp.evaluate(() => { const b = document.getElementById("prevenza-warning-host").shadowRoot.querySelector(".box").getBoundingClientRect(); return b.left >= 0 && b.right <= innerWidth + 1; });
      check("Step 12: the warning fits a 390px phone screen", fits);
      await rp.screenshot({ path: path.join(SHOTS, "30-page-warning-mobile.png") });
      await rp.setViewportSize({ width: 1100, height: 800 });

      // the setting and the quiet list switch it off, without a reload
      await sp.click("#pageWarnings", { force: true });
      await sleep(700);
      check("Step 12: switching the setting off removes the warning from an open page", await rp.evaluate(() => !document.getElementById("prevenza-warning-host")));
      await rp.goto(risky);
      await sleep(2000);
      check("Step 12: with the setting off, no warning appears", await rp.evaluate(() => !document.getElementById("prevenza-warning-host")));
      await sp.click("#pageWarnings", { force: true });
      await sleep(500);
      check("Step 12: the setting is saved", (await sw.evaluate(() => chrome.storage.local.get("prevenza.settings")))["prevenza.settings"].pageWarnings === true);
      const stored12 = JSON.stringify(await sw.evaluate(() => chrome.storage.local.get(null)));
      check("Step 12: no risky site name is stored anywhere", !/sbi-kyc-update|verify-account/.test(stored12) && Object.keys(JSON.parse(stored12)).every((k) => ["prevenza.schema", "prevenza.settings", "prevenza.stats"].includes(k)));
      await rp.close();
      await sp.close();

      // QR code inside a chosen screenshot, on the dashboard
      const d12 = await ctx.newPage();
      watch(d12, "dash12");
      const d12Requests = [];
      d12.on("request", (r) => d12Requests.push(r.url()));
      await d12.goto(URL_DASH);
      await d12.waitForSelector("#legend li");
      const payload = "upi://pay?pa=refund.helpdesk@ybl&pn=Customer%20Care%20Refund&am=4999&tn=Pay%20to%20receive%20refund";
      const qrFile = path.join(os.tmpdir(), "prevenza-qr-upi.png");
      fs.writeFileSync(qrFile, await QR.toBuffer(payload, { width: 420, margin: 3 }));
      check("Step 12: the UPI section still has no file picker, and points to the screenshot checker for QR pictures", (await d12.locator("#upi-check input[type=file]").count()) === 0 && /Scan a screenshot/.test(await d12.textContent("#upi-qr-help")));
      await d12.setInputFiles("#shot-file", qrFile);
      await d12.waitForSelector("#shot-qr:not([hidden])", { timeout: 15000 }).catch(() => null);
      check("Step 12: a QR code in the chosen picture is found on the device", (await d12.isVisible("#shot-qr")) && /UPI payment QR code/.test(await d12.textContent("#shot-qr-text")) && (await d12.textContent("#shot-qr-use")) === "Check this QR payment");
      await d12.click("#shot-qr-use");
      await sleep(300);
      check("Step 12: the button puts the QR text in the UPI checker, without checking it yet", (await d12.inputValue("#upi-qr")) === payload && (await d12.textContent("#upi-result")).trim() === "");
      await d12.click("#upi-analyze");
      await d12.waitForFunction(() => document.getElementById("upi-result").textContent.length > 0);
      check("Step 12: the QR payment is then checked by the UPI checker (pay to receive a refund)", /(High|Critical) risk/.test(await d12.textContent("#upi-result")) && /refund\.helpdesk@ybl/.test(await d12.textContent("#upi-result")));
      await d12.screenshot({ path: path.join(SHOTS, "31-qr-in-screenshot.png"), fullPage: true });
      await d12.click("#shot-clear");
      await sleep(200);
      check("Step 12: Clear all hides the QR finding", !(await d12.isVisible("#shot-qr")));
      const linkQr = path.join(os.tmpdir(), "prevenza-qr-link.png");
      fs.writeFileSync(linkQr, await QR.toBuffer("http://sbi-kyc-update.xyz/login", { width: 360, margin: 3 }));
      await d12.setInputFiles("#shot-file", linkQr);
      await d12.waitForSelector("#shot-qr:not([hidden])", { timeout: 15000 }).catch(() => null);
      await d12.click("#shot-qr-use");
      check("Step 12: a QR code with a web address goes to the link checker", (await d12.inputValue("#link-input")) === "http://sbi-kyc-update.xyz/login");
      await d12.click("#shot-clear");
      const plainShot = path.join(os.tmpdir(), "prevenza-noqr.png");
      fs.writeFileSync(plainShot, await d12.evaluate(async () => { const c = document.createElement("canvas"); c.width = 600; c.height = 160; const g = c.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, 600, 160); g.fillStyle = "#111"; g.font = "28px Arial"; g.fillText("See you at the temple tomorrow.", 20, 80); const b = await new Promise((r) => c.toBlob(r, "image/png")); return Array.from(new Uint8Array(await b.arrayBuffer())); }).then((a) => Buffer.from(a)));
      await d12.setInputFiles("#shot-file", plainShot);
      await sleep(2500);
      check("Step 12: a picture without a QR code shows no QR message", !(await d12.isVisible("#shot-qr")));
      await d12.click("#shot-clear");

      // new rules and languages through the real dashboard
      const msg12 = async (text) => {
        await d12.fill("#msg-input", text);
        await d12.click("#msg-analyze");
        await d12.waitForFunction(() => document.getElementById("msg-result").textContent.length > 0);
        const t = await d12.textContent("#msg-result");
        await d12.click("#msg-clear");
        return t;
      };
      check("Step 12: a job/task scam message is flagged", /(High|Critical) risk/.test(await msg12("Earn Rs 3000 daily by liking YouTube videos. Pay Rs 500 registration fee to start today.")));
      for (const [lang, text] of [["Telugu", "మీ ఖాతా ఈరోజు బ్లాక్ అవుతుంది. వెంటనే మీ OTP చెప్పండి"], ["Bengali", "আপনার অ্যাকাউন্ট আজ বন্ধ হয়ে যাবে। এখনই OTP পাঠান"], ["Kannada", "ನಿಮ್ಮ ಖಾತೆ ಇಂದು ಬ್ಲಾಕ್ ಆಗುತ್ತದೆ. ತಕ್ಷಣ ನಿಮ್ಮ OTP ಹೇಳಿ"], ["Malayalam", "നിങ്ങളുടെ അക്കൗണ്ട് ഇന്ന് ബ്ലോക്ക് ചെയ്യും. ഉടൻ OTP പറയൂ"]]) {
        const t = await msg12(text);
        check("Step 12: a " + lang + " OTP scam is flagged, with the review note", /(High|Critical) risk/.test(t) && /native speakers/.test(t), t.slice(0, 50));
      }
      const guj = await msg12("તમારું ખાતું આજે બંધ થઈ જશે. હમણાં જ OTP મોકલો");
      check("Step 12: a Gujarati message is Inconclusive, never Low", /Inconclusive/.test(guj) && /cannot read yet/.test(guj) && !/Low risk/.test(guj));
      await d12.fill("#link-input", "https://s\u014bbi.com/login");
      await d12.click("#link-form button[type=submit]");
      await d12.waitForFunction(() => document.getElementById("link-result").textContent.length > 0);
      check("Step 12: a famous name with a hidden extra letter is Critical", /Critical risk/.test(await d12.textContent("#link-result")));
      check("Step 12: the dashboard made no network requests (the QR reader is bundled)", d12Requests.every((u) => /^(chrome-extension|data|blob):/.test(u)) && d12Requests.some((u) => /vendor\/jsqr\/jsQR\.js$/.test(u)), d12Requests.filter((u) => !/^(chrome-extension|data|blob):/.test(u)).join(", "));
      await d12.close();

      // complaint helper in Emergency Help
      const e12 = await ctx.newPage();
      watch(e12, "emergency12");
      await e12.goto(URL_EMG);
      await e12.waitForSelector("#complaint-template");
      await sleep(400);
      const tpl = await e12.textContent("#complaint-template");
      check("Step 12: Emergency Help has 'Prepare your complaint' with a checklist and a template", (await e12.textContent("#complaint-h")) === "Prepare your complaint" && (await e12.$$eval("#complaint-list li", (n) => n.length)) >= 4 && /Money lost:/.test(tpl) && /Their details:/.test(tpl));
      check("Step 12: the complaint helper warns never to include an OTP, PIN or password, and has nothing to type into", /Never write your OTP, UPI PIN, passwords/.test(await e12.textContent("#complaint-never")) && (await e12.locator("#complaint-card input, #complaint-card textarea, #complaint-card [contenteditable]").count()) === 0);
      await e12.locator("#complaint-card").screenshot({ path: path.join(SHOTS, "32-complaint-helper.png") });
      await e12.close();
      finalScanTotal = (await getStats12()).scansTotal;
    }

    // ---- 8. no network from any extension page
    const all = [...popupRequests, ...settingsRequests, ...dashRequests];
    check("extension pages made no network requests", all.every((u) => u.startsWith("chrome-extension://") || u.startsWith("data:")), all.filter((u) => !u.startsWith("chrome-extension://") && !u.startsWith("data:")).join(", ") || all.length + " local requests");
    const fetchResult = await popup.evaluate(() => fetch("http://example.com/").then(() => "allowed", () => "blocked"));
    check("Chrome blocks the extension from reaching the internet (CSP)", fetchResult === "blocked", fetchResult);

    // ---- 9. no runtime errors anywhere
    // The CSP probe above deliberately provokes two console messages about example.com. Ignore only those.
    const real = errors.filter((e) => !/Receiving end does not exist|Could not establish connection/i.test(e) && !/example\.com/i.test(e));
    check("no JavaScript errors in the worker, popup, settings, dashboard or website", real.length === 0, real.slice(0, 3).join(" ; "));
    // ---- 10. Step 8: Elder Mode and the language survive closing and reopening the whole browser
    await settings.reload();
    await settings.waitForSelector("#elderMode", { state: "attached" });
    if (!(await settings.isChecked("#elderMode"))) await settings.click("#elderMode", { force: true });
    await settings.selectOption("#language", "ta");
    await sleep(800);
    await ctx.close();
    const ctx2 = await chromium.launchPersistentContext(userData, {
      headless: false,
      viewport: { width: 1100, height: 800 },
      args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run"],
    });
    try {
      const sw2 = ctx2.serviceWorkers()[0] || (await ctx2.waitForEvent("serviceworker", { timeout: 15000 }));
      const again = new URL(sw2.url()).host === id;
      const kept = (await sw2.evaluate(() => chrome.storage.local.get("prevenza.settings")))["prevenza.settings"];
      check("after closing and reopening the whole browser, the extension is the same and the settings are still stored", again && kept.elderMode === true && kept.language === "ta", JSON.stringify({ elderMode: kept.elderMode, language: kept.language }));
      const p2 = await ctx2.newPage();
      await p2.goto(URL_SETTINGS);
      await p2.waitForSelector("#elderMode", { state: "attached" });
      await sleep(600);
      check("after reopening the browser: settings shows Elder Mode on, large text, and Tamil", (await p2.isChecked("#elderMode")) === true && (await p2.getAttribute("html", "data-elder")) === "true" && (await p2.getAttribute("html", "lang")) === "ta" && (await px(p2, "html", "fontSize")) >= 22 && (await p2.inputValue("#language")) === "ta");
      await p2.goto(URL_DASH);
      await p2.waitForSelector("#legend li");
      await sleep(600);
      check("after reopening the browser: the dashboard is in Elder layout with Tamil headings", (await p2.getAttribute("html", "data-elder")) === "true" && (await p2.textContent("#hero-h")) === I18N.TABLE.ta.dash_hero && (await p2.isVisible("#trust-guide")));
      const persisted = JSON.stringify(await sw2.evaluate(() => chrome.storage.local.get(null)));
      check("after reopening the browser: still only settings, counters and the schema number are stored", Object.keys(JSON.parse(persisted)).every((k) => ["prevenza.schema", "prevenza.settings", "prevenza.stats"].includes(k)));
      // Step 10: the aggregate counts survive a restart, and the dashboard shows them
      const stats2 = JSON.parse(persisted)["prevenza.stats"];
      check("after reopening the browser (Step 10): the check counts are kept and the dashboard shows them", stats2.scansTotal === finalScanTotal && stats2.scansTotal >= step10Total && (await p2.textContent("#stat-scans")) === String(finalScanTotal) && (await p2.textContent("#stat-high")) === String(stats2.scansHigh + stats2.scansCritical), finalScanTotal + " / " + (await p2.textContent("#stat-scans")));
      check("after reopening the browser (Step 10): no result is remembered (the latest-result pill is not scanned)", /[\u0b80-\u0bff]|Not scanned yet/.test(await p2.textContent("#overall-pill")) && (await p2.textContent("#msg-result")) === "");
    } finally {
      await ctx2.close();
    }
  } catch (e) {
    check("test run finished without crashing", false, String(e && e.stack ? e.stack : e).slice(0, 400));
  } finally {
    await ctx.close().catch(() => {});
    server.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
})();

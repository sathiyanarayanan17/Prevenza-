// Real-browser test: loads the extension into Chromium and checks it end to end.
// One-time setup: npx playwright-core install chromium
// Run:            npm run test:e2e   (opens a browser window for about 30 seconds)
const { chromium } = require("playwright-core");
const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");

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
  const ctx = await chromium.launchPersistentContext(userData, {
    headless: false,
    viewport: { width: 1100, height: 800 },
    args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, "--no-first-run"],
  });

  const errors = [];
  const watch = (page, label) => {
    page.on("pageerror", (e) => errors.push(`${label}: ${e.message}`));
    page.on("console", (m) => { if (m.type() === "error") errors.push(`${label}: ${m.text()}`); });
  };

  try {
    // ---- 1. extension loads, service worker runs
    let sw = ctx.serviceWorkers()[0] || (await ctx.waitForEvent("serviceworker", { timeout: 15000 }));
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
    check("dashboard shows the four risk levels", (await dash.$$eval("#legend li", (l) => l.length)) === 4);
    check("dashboard counts the pages watched", parseInt(await dash.textContent("#stat-pages"), 10) >= 1, "pages: " + (await dash.textContent("#stat-pages")));
    check("dashboard shows planned features honestly (no fake detection)", (await dash.$$eval("#road .chip", (c) => c.filter((x) => x.textContent === "Planned").length)) >= 6);
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
    check("link checker: look-alike alphabet trick is High risk", /High risk/.test(out) && /alphabets/i.test(out));
    out = await checkLink("https://sbi.co.in@evil.com/");
    check("link checker: the @ trick is caught and the real site is named", /High risk/.test(out) && /evil\.com/.test(out));
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

    // The popup on a real website tab (the page is served from a look-alike name by the test browser, no real network)
    const scam = await ctx.newPage();
    watch(scam, "look-alike site");
    await scam.route("http://sbi-kyc-update.xyz/**", (route) => route.fulfill({ contentType: "text/html", body: "<!doctype html><title>Fake</title><h1>Pretend login</h1>" }));
    await scam.goto("http://sbi-kyc-update.xyz/login");
    await sleep(1200);
    check("content script still reports only the site name on a look-alike page", await sw.evaluate(async () => {
      const tabs = await chrome.tabs.query({});
      for (const t of tabs) {
        try { const r = await chrome.tabs.sendMessage(t.id, { type: "prevenza/get-tab-status" }); if (r && r.hostname === "sbi-kyc-update.xyz") return Object.keys(r).sort().join() === "badgeVisible,enabled,hostname,muted,protocol,ready,ok".split(",").sort().join(); } catch (e) { /* no content script */ }
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
    await popup2.screenshot({ path: path.join(SHOTS, "8-popup-high-risk.png") });

    // protection off -> the popup must not scan
    await popup2.click("#enabled", { force: true });
    await sleep(700);
    check("protection off: the popup goes back to 'Not scanned yet' and says why", (await popup2.textContent("#risk-pill")) === "Not scanned yet" && /Protection is off/.test(await popup2.textContent("#risk-help")));
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

    // ---- 8. no network from any extension page
    const all = [...popupRequests, ...settingsRequests, ...dashRequests];
    check("extension pages made no network requests", all.every((u) => u.startsWith("chrome-extension://") || u.startsWith("data:")), all.filter((u) => !u.startsWith("chrome-extension://") && !u.startsWith("data:")).join(", ") || all.length + " local requests");
    const fetchResult = await popup.evaluate(() => fetch("http://example.com/").then(() => "allowed", () => "blocked"));
    check("Chrome blocks the extension from reaching the internet (CSP)", fetchResult === "blocked", fetchResult);

    // ---- 9. no runtime errors anywhere
    // The CSP probe above deliberately provokes two console messages about example.com. Ignore only those.
    const real = errors.filter((e) => !/Receiving end does not exist|Could not establish connection/i.test(e) && !/example\.com/i.test(e));
    check("no JavaScript errors in the worker, popup, settings, dashboard or website", real.length === 0, real.slice(0, 3).join(" ; "));
  } catch (e) {
    check("test run finished without crashing", false, String(e && e.stack ? e.stack : e).slice(0, 400));
  } finally {
    await ctx.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
})();

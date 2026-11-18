// Real-browser test for the website (web/): loads the pages from the local dev server in Chromium and uses them.
// One-time setup: npx playwright-core install chromium
// Run:            npm run test:e2e:web   (headless, about 1 minute; screenshots go to e2e/shots/web-*.png)
"use strict";
const { chromium } = require("playwright-core");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { start } = require("../scripts/serve-web.js");
const QR = require("qrcode");
const { build: buildMobile } = require("../scripts/build-mobile.js");

const SHOTS = path.join(__dirname, "shots");
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
function check(name, ok, detail) {
  results.push({ name, ok: !!ok });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  (" + detail + ")" : ""}`);
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  const { server, url: origin } = await start(0);
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1100, height: 800 }, acceptDownloads: false });

  // Every request the pages make, and every console error, across the whole run.
  const requests = [];
  const errors = [];
  context.on("request", (r) => requests.push(r.url()));
  const open = async (pagePath) => {
    const page = await context.newPage();
    page.on("pageerror", (e) => errors.push(`${pagePath}: ${e.message} @ ${String(e.stack || "").split("\n").slice(1, 3).join(" ").trim()}`));
    page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${pagePath}: [${m.type()}] ${m.text()}`); });
    page.on("response", (r) => { if (r.status() >= 400) errors.push(`${pagePath}: HTTP ${r.status()} ${r.url()}`); });
    page.on("requestfailed", (r) => errors.push(`${pagePath}: request failed ${r.url()}`));
    await page.goto(origin + pagePath);
    await page.waitForLoadState("load");
    await sleep(500);
    return page;
  };
  const shot = (page, name, full) => page.screenshot({ path: path.join(SHOTS, "web-" + name + ".png"), fullPage: full !== false });
  const noSidewaysScroll = (page) => page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth + 1);

  try {
    // ---- 1. every page loads without console errors
    const home = await open("/web/");
    const checker = await open("/web/app/check.html");
    const emergency = await open("/web/app/emergency.html");
    const rootRedirect = await context.newPage();
    await rootRedirect.goto(origin + "/");
    check("the server sends / to /web/", new URL(rootRedirect.url()).pathname === "/web/", rootRedirect.url());
    await rootRedirect.close();

    check("landing page: title and the headline", /Prevenza/.test(await home.title()) && (await home.textContent("h1")).trim() === "Pause. Check. Stay safe.");
    check("landing page: the mascot is placed", (await home.$$eval("[data-mascot] svg, [data-mascot] img, [data-mascot] canvas", (n) => n.length)) >= 2);
    check("checker page loads and shows all four checkers", (await checker.$$eval("#link-check, #message-check, #upi-check, #screenshot-check", (n) => n.length)) === 4);
    check("emergency page loads and lists the situations", (await emergency.$$eval("#incident-list button, #incident-list a, #incident-list input", (n) => n.length)) >= 7, String(await emergency.$$eval("#incident-list > *", (n) => n.length)));
    check("pages: no console errors, warnings, failed or error-status requests on the first load", errors.length === 0, errors.join(" | "));

    // ---- 2. landing page content
    const homeText = await home.textContent("body");
    for (const [name, re] of [
      ["Common scams in India", /Common scams in India/], ["How it works", /How it works/], ["What it can check", /What it can check/],
      ["an Example label", /Example/], ["Privacy", /Privacy/], ["Honest limits", /Honest limits/], ["Get Prevenza", /Get Prevenza/],
      ["helpline 1930", /1930/], ["cybercrime.gov.in", /cybercrime\.gov\.in/],
    ]) check("landing page shows: " + name, re.test(homeText));
    check("landing page: the example shows the engine's category (High risk) and the warning level, not a probability", /High risk/.test(await home.textContent(".example")) && /Warning level 70 of 100/.test(await home.textContent(".example")));
    check("landing page: html lang stays English", (await home.getAttribute("html", "lang")) === "en");
    check("landing page: no page text says something is safe", !/\b(is|are) safe\b/i.test(homeText.replace(/never means something is safe or genuine/, "")));
    const links = await home.$$eval("a[href]", (as) => as.map((a) => a.getAttribute("href")));
    check("landing page: the four checker cards link to their checkers", ["app/check.html#link-check", "app/check.html#message-check", "app/check.html#upi-check", "app/check.html#screenshot-check"].every((l) => links.includes(l)));
    const external = links.filter((l) => /^https?:/.test(l));
    check("landing page: the only external link is the GitHub repository", external.length === 1 && external[0] === "https://github.com/sathiyanarayanan17/Prevenza-", external.join(","));
    await shot(home, "landing");

    await home.click("a.btn-primary.btn-lg");
    await home.waitForLoadState("load");
    check("'Check something now' opens the checker page", new URL(home.url()).pathname === "/web/app/check.html", home.url());
    await home.goBack();
    await sleep(300);
    await home.click('a.feature[href="app/check.html#message-check"]');
    await home.waitForLoadState("load");
    await sleep(300);
    check("a checker card opens the right checker", home.url().endsWith("/web/app/check.html#message-check"));
    await home.close();

    // ---- 3. link checker
    await checker.fill("#link-input", "http://sbi-kyc-update.xyz/login");
    await checker.click("#link-form button[type=submit]");
    await checker.waitForFunction(() => document.getElementById("link-result").textContent.length > 0);
    const linkText = await checker.textContent("#link-result");
    check("link checker: a look-alike bank link gets a High risk result with a reason", /High risk/.test(linkText) && /Warning level \d+ of 100/.test(linkText) && !!(await checker.$("#link-result .reasons li")));
    check("link checker: the latest-check pill follows the result", /High risk/.test(await checker.textContent("#overall-pill")));
    await shot(checker, "checker-link");
    await checker.fill("#link-input", "not a link at all ::");
    await checker.click("#link-form button[type=submit]");
    await sleep(300);
    check("link checker: a value that is not a link gets a plain problem message, not a result", !!(await checker.$("#link-result .problem")) || !/Warning level/.test(await checker.textContent("#link-result")));

    // ---- 4. message checker
    await checker.fill("#msg-input", "Dear customer, your SBI KYC is pending. Your account will be blocked today. Share the OTP you just received.");
    await checker.click("#msg-analyze");
    await checker.waitForFunction(() => document.getElementById("msg-result").textContent.length > 0);
    const msgText = await checker.textContent("#msg-result");
    check("message checker: a KYC and OTP scam message is rated High or Critical with the signs listed", /(High|Critical) risk/.test(msgText) && /OTP/.test(msgText), msgText.slice(0, 60));
    check("message checker: suspicious phrases are marked in the user's own text", (await checker.$$eval("#msg-result mark", (n) => n.length)) >= 1);
    await shot(checker, "checker-message");
    await checker.click("#msg-clear");
    check("message checker: Clear empties the box and the result", (await checker.inputValue("#msg-input")) === "" && (await checker.textContent("#msg-result")).trim() === "");
    await checker.fill("#msg-input", "Hi, are we meeting for lunch at 1 pm tomorrow?");
    await checker.click("#msg-analyze");
    await checker.waitForFunction(() => document.getElementById("msg-result").textContent.length > 0);
    const calm = await checker.textContent("#msg-result");
    check("message checker: an ordinary message is never called safe", !/\bis safe\b|\bsafe to\b/i.test(calm) && /(Low|Medium|Inconclusive|No strong)/i.test(calm), calm.slice(0, 80));
    await checker.click("#msg-clear");

    // ---- 5. UPI checker
    await checker.fill("#upi-id", "refund.help@ybl");
    await checker.fill("#upi-reason", "Pay Rs 1 to receive your refund. Enter your PIN to receive money.");
    await checker.click("#upi-analyze");
    await checker.waitForFunction(() => document.getElementById("upi-result").textContent.length > 0);
    const upiText = await checker.textContent("#upi-result");
    check("UPI checker: a 'pay to receive' request is rated High or Critical", /(High|Critical) risk/.test(upiText), upiText.slice(0, 60));
    check("UPI checker: there is no field for a PIN or OTP", (await checker.$$eval("#upi-form input, #upi-form textarea", (n) => n.filter((e) => /pin|otp|password/i.test(e.id + e.name + (e.type || ""))).length)) === 0);
    await shot(checker, "checker-upi");
    await checker.click("#upi-clear");

    // ---- 6. screenshot checker (offline text reading, as in e2e/run.js)
    const makeImage = async (name, lines) => {
      const b64 = await checker.evaluate(async (lines) => {
        const c = document.createElement("canvas");
        c.width = 1000;
        c.height = Math.max(120, 80 + lines.length * 64);
        const g = c.getContext("2d");
        g.fillStyle = "#fff";
        g.fillRect(0, 0, c.width, c.height);
        g.fillStyle = "#111";
        g.font = "30px Arial";
        g.textBaseline = "top";
        lines.forEach((l, i) => g.fillText(l, 30, 30 + i * 64));
        const blob = await new Promise((r) => c.toBlob(r, "image/png"));
        const buf = new Uint8Array(await blob.arrayBuffer());
        let s = "";
        for (let i = 0; i < buf.length; i++) s += String.fromCharCode(buf[i]);
        return btoa(s);
      }, lines);
      const file = path.join(os.tmpdir(), name);
      fs.writeFileSync(file, Buffer.from(b64, "base64"));
      return file;
    };
    const requestsBeforeOcr = requests.length;
    const png = await makeImage("prevenza-web-scam.png", ["Dear customer, your SBI KYC is pending.", "Your account will be blocked today.", "Please share the OTP you just received."]);
    await checker.setInputFiles("#shot-file", png);
    await sleep(400);
    check("screenshot checker: choosing a PNG shows a preview and enables reading", !(await checker.isHidden("#shot-preview")) && !(await checker.isDisabled("#shot-analyze")));
    await checker.click("#shot-analyze");
    await checker.waitForFunction(() => document.getElementById("shot-result").textContent.length > 0 || !document.getElementById("shot-problem").hidden, null, { timeout: 90000 });
    const shotText = await checker.textContent("#shot-result");
    const problem = await checker.isHidden("#shot-problem") ? "" : await checker.textContent("#shot-problem");
    check("screenshot checker: the text is read on the device and the scam is rated High or Critical", /(High|Critical) risk/.test(shotText) && problem === "", shotText.slice(0, 60) + (problem ? " problem: " + problem : ""));
    const read = await checker.inputValue("#shot-text");
    check("screenshot checker: the text that was read is shown for correction", /KYC/i.test(read) && /OTP/i.test(read), read.slice(0, 60).replace(/\s+/g, " "));
    const ocrRequests = requests.slice(requestsBeforeOcr).filter((u) => !u.startsWith("blob:") && !u.startsWith("data:"));
    check("screenshot checker: the OCR engine and language data came from this server only", ocrRequests.every((u) => u.startsWith(origin + "/")) && ocrRequests.some((u) => /vendor\/tesseract/.test(u)), ocrRequests.length + " requests");
    await shot(checker, "checker-screenshot");
    await checker.click("#shot-clear");
    check("screenshot checker: Clear all removes the image, the text and the result", (await checker.inputValue("#shot-text")) === "" && (await checker.textContent("#shot-result")).trim() === "" && (await checker.isHidden("#shot-preview")));
    await checker.setInputFiles("#shot-file", { name: "notes.png", mimeType: "image/png", buffer: Buffer.from("this is plain text renamed to look like a png file") });
    await sleep(400);
    check("screenshot checker: a file that is not really an image is refused", /PNG and JPEG screenshots/.test(await checker.textContent("#shot-problem")));
    await checker.click("#shot-clear");

    // ---- 7. counts, what is stored, and reset
    const scans = Number(await checker.textContent("#stat-scans"));
    check("counts: they went up with the checks that were run (link, message x2, UPI, screenshot)", scans >= 4, "checks done: " + scans);
    check("counts: the last-check time is shown", !/No checks yet|Unavailable|^-$/.test((await checker.textContent("#stat-lastscan")).trim()), await checker.textContent("#stat-lastscan"));
    const stored = await checker.evaluate(() => Object.fromEntries(Object.entries(localStorage)));
    const storedText = JSON.stringify(stored).toLowerCase();
    check("storage: only prevenza-web: keys, settings and counters", Object.keys(stored).every((k) => /^prevenza-web:prevenza\.(schema|settings|stats)$/.test(k)), Object.keys(stored).join(", "));
    check("storage: no link, message, UPI detail or screenshot text is stored", !/refund\.help|sbi-kyc|kyc is pending|share the otp|dear customer|pay rs 1|lunch/.test(storedText));
    await checker.click("#reset-stats");
    check("counts: Reset needs a second press", /Press again/.test(await checker.textContent("#reset-stats")) && Number(await checker.textContent("#stat-scans")) === scans);
    await checker.click("#reset-stats");
    await sleep(400);
    check("counts: the second press resets every count", (await checker.textContent("#stat-scans")).trim() === "0" && (await checker.textContent("#stat-high")).trim() === "0" && /No checks yet/.test(await checker.textContent("#stat-lastscan")));
    await shot(checker, "checker-counts", false);

    // ---- 8. language switch (kept after a reload)
    await checker.selectOption("#pref-language", "hi");
    await sleep(500);
    const hiHeading = (await checker.textContent("#tools-h")).trim();
    check("language: switching to Hindi changes the headings and html lang", hiHeading !== "What would you like to check?" && /[\u0900-\u097F]/.test(hiHeading) && (await checker.getAttribute("html", "lang")) === "hi", hiHeading);
    await checker.selectOption("#pref-language", "ta");
    await sleep(500);
    check("language: switching to Tamil changes the headings", /[\u0B80-\u0BFF]/.test(await checker.textContent("#tools-h")));
    await shot(checker, "checker-tamil", false);
    await checker.reload();
    await sleep(600);
    check("language: the choice is kept after reloading the page", (await checker.inputValue("#pref-language")) === "ta" && (await checker.getAttribute("html", "lang")) === "ta");
    await checker.selectOption("#pref-language", "en");
    await sleep(400);
    check("language: back to English", (await checker.textContent("#tools-h")).trim() === "What would you like to check?");

    // ---- 9. Elder Mode: 22px text and buttons at least 56px tall
    await checker.check("#pref-elder", { force: true });
    await sleep(500);
    check("Elder Mode: turning it on sets data-elder", (await checker.getAttribute("html", "data-elder")) === "true");
    check("Elder Mode: body text is 22px", (await checker.evaluate(() => getComputedStyle(document.body).fontSize)) === "22px");
    const small = await checker.evaluate(() => {
      const bad = [];
      document.querySelectorAll("button, a.btn, label.btn, .btn").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.width === 0 || r.height === 0) return; // hidden
        if (r.height < 56 - 0.5) bad.push((el.id || el.className || el.tagName) + ":" + Math.round(r.height));
      });
      return bad;
    });
    check("Elder Mode: every visible button is at least 56px tall", small.length === 0, small.join(", "));
    const inputs = await checker.evaluate(() => [...document.querySelectorAll("input[type=text], select, textarea")].filter((e) => e.getBoundingClientRect().height > 0).map((e) => e.getBoundingClientRect().height));
    check("Elder Mode: text fields are at least 44px tall", inputs.every((h) => h >= 44), inputs.map(Math.round).join(","));
    check("Elder Mode: the 'Ask someone you trust' guide is shown", await checker.isVisible("#trust-guide"));
    await shot(checker, "checker-elder");
    // Elder Mode carries over to the other pages
    const homeElder = await open("/web/");
    check("Elder Mode: the landing page uses the saved choice, 22px text and big buttons", (await homeElder.getAttribute("html", "data-elder")) === "true" && (await homeElder.evaluate(() => getComputedStyle(document.body).fontSize)) === "22px" && (await homeElder.evaluate(() => document.querySelector(".btn-lg").getBoundingClientRect().height)) >= 56 && (await homeElder.getAttribute("html", "lang")) === "en");
    await shot(homeElder, "landing-elder");
    const emgElder = await open("/web/app/emergency.html");
    check("Elder Mode: Emergency Help uses it too", (await emgElder.getAttribute("html", "data-elder")) === "true");
    await shot(emgElder, "emergency-elder");
    await homeElder.close();
    await emgElder.close();

    // ---- 10. emergency page
    await emergency.reload();
    await sleep(500);
    const first = await emergency.$("#incident-list button");
    if (first) await first.click();
    await sleep(400);
    check("Emergency Help: choosing a situation shows steps", !(await emergency.isHidden("#steps-card")) && (await emergency.textContent("#steps-body")).trim().length > 40);
    check("Emergency Help: shows helpline 1930 and the official portal address", /1930/.test(await emergency.textContent("#helpline-number")) && /cybercrime\.gov\.in/.test(await emergency.textContent("#portal-address")));
    check("Emergency Help: nothing was opened or sent by choosing a situation", context.pages().every((p) => p.url().startsWith(origin)));
    await shot(emergency, "emergency");

    // ---- 11. switch Elder Mode off again, then mobile width (390px) on every page
    await checker.uncheck("#pref-elder", { force: true });
    await sleep(400);
    check("Elder Mode: turning it off restores normal text", (await checker.getAttribute("html", "data-elder")) === "false" && (await checker.evaluate(() => getComputedStyle(document.body).fontSize)) !== "22px");
    for (const elder of [false, true]) {
      if (elder) { await checker.check("#pref-elder", { force: true }); await sleep(400); }
      for (const [name, pagePath] of [["landing", "/web/"], ["checker", "/web/app/check.html"], ["emergency", "/web/app/emergency.html"]]) {
        const p = await open(pagePath);
        await p.setViewportSize({ width: 390, height: 800 });
        await sleep(300);
        check(`mobile 390px${elder ? " with Elder Mode" : ""}: ${name} page has no sideways scroll`, await noSidewaysScroll(p), (await p.evaluate(() => document.documentElement.scrollWidth)) + "px wide");
        if (name === "checker") {
          // results are the widest content: show one on a narrow screen as well
          await p.fill("#msg-input", "Dear customer, your SBI KYC is pending. Share the OTP now http://bit.ly/abc12345678901234567890");
          await p.click("#msg-analyze");
          await p.waitForFunction(() => document.getElementById("msg-result").textContent.length > 0);
          check(`mobile 390px${elder ? " with Elder Mode" : ""}: checker page still has no sideways scroll with a result shown`, await noSidewaysScroll(p), (await p.evaluate(() => document.documentElement.scrollWidth)) + "px wide");
        }
        await shot(p, `mobile-${name}${elder ? "-elder" : ""}`);
        await p.close();
      }
    }
    await checker.uncheck("#pref-elder", { force: true });
    await sleep(300);

    // ---- 14. Step 12 on the website: QR codes in screenshots, the complaint helper, new rules and languages
    const s12 = await open("/web/app/check.html");
    const payload12 = "upi://pay?pa=refund.helpdesk@ybl&pn=Customer%20Care%20Refund&am=4999&tn=Pay%20to%20receive%20refund";
    const qr12 = path.join(os.tmpdir(), "prevenza-web-qr.png");
    fs.writeFileSync(qr12, await QR.toBuffer(payload12, { width: 420, margin: 3 }));
    const reqBeforeQr = requests.length;
    await s12.setInputFiles("#shot-file", qr12);
    await s12.waitForSelector("#shot-qr:not([hidden])", { timeout: 15000 }).catch(() => null);
    check("website (Step 12): a UPI QR code in the chosen picture is found on the device", (await s12.isVisible("#shot-qr")) && (await s12.textContent("#shot-qr-use")) === "Check this QR payment");
    check("website (Step 12): the QR reader came from this server", requests.slice(reqBeforeQr).some((u) => u === origin + "/vendor/jsqr/jsQR.js"));
    await s12.click("#shot-qr-use");
    check("website (Step 12): the QR text goes to the UPI checker and is not checked until asked", (await s12.inputValue("#upi-qr")) === payload12 && (await s12.textContent("#upi-result")).trim() === "");
    await s12.click("#upi-analyze");
    await s12.waitForFunction(() => document.getElementById("upi-result").textContent.length > 0);
    check("website (Step 12): the QR payment is rated High or Critical", /(High|Critical) risk/.test(await s12.textContent("#upi-result")));
    await shot(s12, "qr-in-screenshot");
    await s12.click("#shot-clear");
    await s12.click("#upi-clear");
    const msgOnce = async (text) => {
      await s12.fill("#msg-input", text);
      await s12.click("#msg-analyze");
      await s12.waitForFunction(() => document.getElementById("msg-result").textContent.length > 0);
      const t = await s12.textContent("#msg-result");
      await s12.click("#msg-clear");
      return t;
    };
    check("website (Step 12): a job/task scam is flagged", /(High|Critical) risk/.test(await msgOnce("Earn Rs 3000 daily by liking YouTube videos. Pay Rs 500 registration fee to start today.")));
    check("website (Step 12): a Telugu OTP scam is flagged", /(High|Critical) risk/.test(await msgOnce("మీ ఖాతా ఈరోజు బ్లాక్ అవుతుంది. వెంటనే మీ OTP చెప్పండి")));
    check("website (Step 12): a Gujarati message is Inconclusive, never Low", /Inconclusive/.test(await msgOnce("તમારું ખાતું આજે બંધ થઈ જશે. હમણાં જ OTP મોકલો")));
    await s12.fill("#link-input", "https://sbii-bank.com/login");
    await s12.click("#link-form button[type=submit]");
    await s12.waitForFunction(() => document.getElementById("link-result").textContent.length > 0);
    check("website (Step 12): a doubled-letter bank look-alike is flagged", /(Medium|High|Critical) risk/.test(await s12.textContent("#link-result")));
    const stored12 = JSON.stringify(await s12.evaluate(() => Object.entries(localStorage)));
    check("website (Step 12): nothing from these checks is stored", !/refund\.helpdesk|upi:\/\/|youtube|sbii|ખાતું|ఖాతా/i.test(stored12));
    await s12.close();
    const em12 = await open("/web/app/emergency.html");
    check("website (Step 12): Emergency Help shows 'Prepare your complaint' with a template, and nothing to type into", (await em12.textContent("#complaint-h")) === "Prepare your complaint" && /Money lost:/.test(await em12.textContent("#complaint-template")) && (await em12.locator("#complaint-card input, #complaint-card textarea").count()) === 0);
    await em12.setViewportSize({ width: 390, height: 800 });
    await sleep(200);
    check("website (Step 12): the complaint template fits a 390px screen", await noSidewaysScroll(em12));
    await em12.close();

    // ---- 13. the Android app's files (mobile/www) with a pretend Capacitor, to test "Share to Prevenza"
    buildMobile();
    const fakeShare = async (item) => {
      const p = await context.newPage();
      p.on("pageerror", (e) => errors.push(`mobile: ${e.message}`));
      p.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`mobile: [${m.type()}] ${m.text()}`); });
      await p.addInitScript((shared) => {
        let pending = shared;
        window.Capacitor = {
          nativePromise: async (plugin, method) => {
            if (plugin !== "ShareTarget" || method !== "getShared") throw new Error("unexpected call " + plugin + "." + method);
            const out = pending || { kind: "none" };
            pending = null; // the real plugin hands each shared item over once
            return out;
          },
          addListener: () => ({ remove: async () => {} }),
        };
      }, item);
      await p.goto(origin + "/mobile/www/");
      await p.waitForLoadState("load");
      await sleep(900);
      return p;
    };
    const appStart = await fakeShare({ kind: "none" });
    check("app: the start page opens the checker", new URL(appStart.url()).pathname === "/mobile/www/web/app/check.html", appStart.url());
    check("app: nothing is filled in when nothing was shared", (await appStart.inputValue("#msg-input")) === "" && (await appStart.inputValue("#link-input")) === "" && (await appStart.isDisabled("#shot-analyze")));
    await appStart.close();

    const sharedText = await fakeShare({ kind: "text", text: "Dear customer, your SBI KYC is pending. Share the OTP now." });
    check("app: shared text goes into the message box but is not checked by itself", (await sharedText.inputValue("#msg-input")).includes("KYC is pending") && (await sharedText.textContent("#msg-result")).trim() === "");
    await sharedText.click("#msg-analyze");
    await sharedText.waitForFunction(() => document.getElementById("msg-result").textContent.length > 0);
    check("app: pressing Analyze message checks the shared text", /(High|Critical) risk/.test(await sharedText.textContent("#msg-result")));
    await shot(sharedText, "app-share-text", false);
    await sharedText.close();

    const sharedLink = await fakeShare({ kind: "text", text: "http://sbi-kyc-update.xyz/login" });
    check("app: a shared link goes into the link box", (await sharedLink.inputValue("#link-input")) === "http://sbi-kyc-update.xyz/login" && (await sharedLink.inputValue("#msg-input")) === "");
    await sharedLink.close();

    const sharedPng = await fakeShare({ kind: "image", mime: "image/png", base64: fs.readFileSync(png).toString("base64") });
    check("app: a shared image goes into the screenshot checker with a preview", !(await sharedPng.isHidden("#shot-preview")) && !(await sharedPng.isDisabled("#shot-analyze")));
    await sharedPng.click("#shot-analyze");
    await sharedPng.waitForFunction(() => document.getElementById("shot-result").textContent.length > 0 || !document.getElementById("shot-problem").hidden, null, { timeout: 90000 });
    check("app: the shared screenshot is read offline and rated High or Critical", /(High|Critical) risk/.test(await sharedPng.textContent("#shot-result")), (await sharedPng.textContent("#shot-result")).slice(0, 40));
    await shot(sharedPng, "app-share-image", false);
    await sharedPng.close();

    const sharedGif = await fakeShare({ kind: "unsupported" });
    check("app: an unsupported image type fills nothing and says so", (await sharedGif.isDisabled("#shot-analyze")) && /PNG and JPEG/.test(await sharedGif.textContent("#toast")));
    await sharedGif.close();

    // ---- 12. nothing left the machine (the whole run, including the app's files)
    const outside = requests.filter((u) => !u.startsWith(origin + "/") && !u.startsWith("blob:") && !u.startsWith("data:") && u !== "about:blank");
    check("network: every request went to the same origin (the local server)", outside.length === 0, outside.slice(0, 3).join(", "));
    check("network: no request carried a query string or body with what was checked", requests.every((u) => !/sbi-kyc|refund\.help|kyc|otp/i.test(decodeURIComponent(u))));
    check("console: no errors or warnings on any page during the whole run", errors.length === 0, errors.slice(0, 3).join(" | "));
  } catch (e) {
    check("the run finished without an unexpected error", false, e && e.stack ? e.stack.split("\n").slice(0, 4).join(" / ") : String(e));
  } finally {
    await browser.close();
    server.close();
  }

  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} browser checks passed`);
  process.exit(failed ? 1 : 0);
})();

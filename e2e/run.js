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

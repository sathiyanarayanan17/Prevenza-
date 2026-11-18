// The website (web/) and its dev server: security rules, links, storage and the in-page router. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const http = require("node:http");
const vm = require("node:vm");

const root = path.join(__dirname, "..");
const webDir = path.join(root, "web");
const GITHUB = "https://github.com/sathiyanarayanan17/Prevenza-";

function walk(dir, ext, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, ext, acc);
    else if (entry.name.endsWith(ext)) acc.push(full);
  }
  return acc;
}
const rel = (file) => path.relative(root, file).split(path.sep).join("/");
const read = (file) => fs.readFileSync(file, "utf8");
const pages = walk(webDir, ".html");
const webJs = walk(webDir, ".js");
const webCss = walk(webDir, ".css");
const webFiles = [...pages, ...webJs, ...webCss];

test("the website has the expected pages", () => {
  const names = pages.map(rel).sort();
  assert.deepEqual(names, ["web/app/check.html", "web/app/emergency.html", "web/index.html"]);
});

// ---------------------------------------------------------------- page security

test("every page has the security policy with connect-src 'none' and nothing remote", () => {
  for (const file of pages) {
    const html = read(file);
    const tag = html.match(/<meta\s+http-equiv="Content-Security-Policy"\s+content="([^"]*)"/i);
    assert.ok(tag, rel(file) + " has no Content-Security-Policy meta tag");
    const csp = tag[1];
    assert.match(csp, /(^|;\s*)connect-src 'none'(;|$)/, rel(file) + " must have connect-src 'none'");
    assert.match(csp, /(^|;\s*)default-src 'self'(;|$)/, rel(file) + " must have default-src 'self'");
    assert.match(csp, /(^|;\s*)object-src 'none'(;|$)/, rel(file) + " must have object-src 'none'");
    assert.match(csp, /(^|;\s*)base-uri 'none'(;|$)/, rel(file) + " must have base-uri 'none'");
    assert.doesNotMatch(csp, /unsafe-inline|unsafe-eval(?!')|https?:|\*/, rel(file) + " has a weak or remote source in its policy");
    // 'wasm-unsafe-eval' (WebAssembly only) is allowed solely for the page that runs the OCR engine.
    const wasm = /'wasm-unsafe-eval'/.test(csp);
    assert.equal(wasm, rel(file) === "web/app/check.html", rel(file) + ": wasm-unsafe-eval only on the checker page");
  }
});

test("pages have no inline script, no inline style, no style attribute and no event-handler attribute", () => {
  for (const file of pages) {
    const html = read(file);
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/gi)) {
      assert.match(m[1], /\bsrc="[^"]+"/, rel(file) + " has an inline <script>");
      assert.equal(m[2].trim(), "", rel(file) + " has a <script src> with inline code");
      assert.doesNotMatch(m[1], /\btype="module"|\bnomodule/i);
    }
    assert.doesNotMatch(html, /<style\b/i, rel(file) + " has a <style> element");
    assert.doesNotMatch(html, /\sstyle\s*=/i, rel(file) + " has a style attribute");
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, rel(file) + " has an on...= attribute");
    assert.doesNotMatch(html, /javascript:/i, rel(file) + " has a javascript: address");
    assert.doesNotMatch(html, /<(iframe|object|embed|form\b[^>]*\baction=)/i, rel(file) + " embeds or posts somewhere");
  }
});

test("every src and href points to a file that exists (or to an id on the page)", () => {
  let checked = 0;
  for (const file of pages) {
    const html = read(file);
    const ids = new Set([...html.matchAll(/\bid="([^"]+)"/g)].map((m) => m[1]));
    for (const m of html.matchAll(/\s(?:src|href)="([^"]*)"/g)) {
      const value = m[1];
      if (/^https?:\/\//.test(value)) continue; // checked by the external-URL test
      checked++;
      if (value.startsWith("#")) {
        assert.ok(value === "#" || ids.has(value.slice(1)), rel(file) + " links to a missing id " + value);
        continue;
      }
      const [target, hash] = value.split("#");
      const resolved = path.resolve(path.dirname(file), target.split("?")[0]);
      assert.ok(fs.existsSync(resolved) && fs.statSync(resolved).isFile(), rel(file) + " points to a missing file: " + value);
      if (hash && resolved.endsWith(".html")) {
        const targetIds = new Set([...read(resolved).matchAll(/\bid="([^"]+)"/g)].map((x) => x[1]));
        assert.ok(targetIds.has(hash), rel(file) + " links to " + value + " but that page has no id " + hash);
      }
    }
  }
  assert.ok(checked > 40, "expected many links to check, found " + checked);
});

test("stylesheets only load local files", () => {
  for (const file of webCss) {
    const css = read(file);
    assert.doesNotMatch(css, /@import|url\(\s*["']?(https?:|\/\/)/i, rel(file) + " loads something remote");
  }
});

// ---------------------------------------------------------------- web JavaScript

test("web JavaScript uses no network API, eval or innerHTML", () => {
  const banned = [
    /\bfetch\s*\(/, /\bXMLHttpRequest\b/, /\bWebSocket\b/, /\bEventSource\b/, /\bsendBeacon\b/, /\bimportScripts\b/,
    /\bnew\s+Worker\b/, /\bServiceWorker\b/i, /\bnavigator\.serviceWorker\b/, /\bRTCPeerConnection\b/,
    /\beval\s*\(/, /\bnew\s+Function\b/, /\bFunction\s*\(/, /\bsetTimeout\s*\(\s*["'`]/, /\bsetInterval\s*\(\s*["'`]/,
    /\binnerHTML\b/, /\bouterHTML\b/, /\binsertAdjacentHTML\b/, /\bdocument\.write\b/, /\bcreateContextualFragment\b/,
    /\bimport\s*\(/, /\bdocument\.cookie\b/, /\bindexedDB\b/, /\bsessionStorage\b/,
  ];
  assert.ok(webJs.length >= 3);
  for (const file of webJs) {
    const code = read(file);
    for (const re of banned) assert.doesNotMatch(code, re, rel(file) + " uses " + re);
  }
});

test("localStorage appears only in web-bridge.js", () => {
  for (const file of webFiles) {
    const uses = /localStorage/.test(read(file));
    assert.equal(uses, rel(file) === "web/js/web-bridge.js", rel(file) + (uses ? " must not use localStorage" : " is expected to use localStorage"));
  }
});

test("the only external URL is the GitHub repository, and only in index.html", () => {
  let found = 0;
  for (const file of webFiles) {
    const text = read(file);
    for (const m of text.matchAll(/(?<![A-Za-z0-9:])(?:https?:)?\/\/[A-Za-z0-9][^\s"'<>)]*/g)) {
      const url = m[0];
      if (!/^(https?:)?\/\//.test(url)) continue;
      // "//" inside a comment such as "// note" has a space after it and never matches; real addresses do.
      assert.equal(rel(file), "web/index.html", rel(file) + " contains an external URL: " + url);
      assert.equal(url, GITHUB, "unexpected external URL " + url);
      found++;
    }
  }
  assert.ok(found >= 1, "the GitHub link is missing from index.html");
});

test("external links open without leaking the page address", () => {
  const html = read(path.join(webDir, "index.html"));
  for (const m of html.matchAll(/<a\b[^>]*href="https?:\/\/[^"]*"[^>]*>/g)) {
    assert.match(m[0], /rel="noopener noreferrer"/);
  }
});

// ---------------------------------------------------------------- the checker page and the reused scripts

test("every element id used by the reused checker scripts exists exactly once in check.html", () => {
  const html = read(path.join(webDir, "app", "check.html"));
  const count = (id) => [...html.matchAll(new RegExp('\\bid="' + id.replace(/[-]/g, "\\-") + '"', "g"))].length;
  const scripts = ["src/dashboard/message-check.js", "src/dashboard/upi-check.js", "src/dashboard/ocr-runner.js", "src/dashboard/screenshot-check.js", "web/js/check-page.js"];
  let total = 0;
  for (const script of scripts) {
    const code = read(path.join(root, script));
    const ids = new Set();
    for (const m of code.matchAll(/(?:\$|getElementById)\(\s*["']([A-Za-z][\w-]*)["']\s*\)/g)) ids.add(m[1]);
    for (const m of code.matchAll(/querySelector(?:All)?\(\s*["']#([A-Za-z][\w-]*)/g)) ids.add(m[1]);
    for (const id of ids) {
      total++;
      assert.equal(count(id), 1, script + " uses #" + id + ", which must appear exactly once in check.html (found " + count(id) + ")");
    }
  }
  assert.ok(total > 40, "expected many ids to check, found " + total);
  // data-target values on the menu cards must also exist.
  for (const m of html.matchAll(/data-target="([^"]+)"/g)) assert.equal(count(m[1]), 1, "data-target #" + m[1]);
  // every id in the page is unique
  const all = [...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]);
  assert.equal(new Set(all).size, all.length, "duplicate ids in check.html");
});

test("the checker page loads the web bridge instead of the extension's messaging, and the pages stay at web/app/", () => {
  for (const name of ["check.html", "emergency.html"]) {
    const html = read(path.join(webDir, "app", name));
    assert.doesNotMatch(html, /shared\/messaging\.js/);
    assert.match(html, /<script src="\.\.\/js\/web-bridge\.js">/);
  }
  const check = read(path.join(webDir, "app", "check.html"));
  assert.match(check, /\.\.\/\.\.\/src\/dashboard\/ocr-runner\.js/);
  const runner = read(path.join(root, "src", "dashboard", "ocr-runner.js"));
  assert.match(runner, /vendor\/tesseract|getURL|\.\.\/\.\.\/vendor/);
  assert.ok(fs.existsSync(path.join(root, "vendor", "tesseract")));
});

// ---------------------------------------------------------------- landing page content

test("the landing page has every required section, and the checker cards link to the right checkers", () => {
  const html = read(path.join(webDir, "index.html"));
  assert.match(html, /<html lang="en"/);
  assert.match(html, /<h1[^>]*>Pause\. Check\. Stay safe\.<\/h1>/);
  assert.match(html, /<a class="btn btn-primary btn-lg" href="app\/check\.html">Check something now<\/a>/);
  for (const id of ["scams", "how", "can-check", "privacy", "limits", "get", "emergency"]) assert.match(html, new RegExp('id="' + id + '"'), "missing section #" + id);
  for (const target of ["link-check", "message-check", "upi-check", "screenshot-check"]) assert.match(html, new RegExp('href="app/check\\.html#' + target + '"'));
  assert.match(html, /href="app\/emergency\.html"/);
  assert.match(html, />1930</);
  assert.match(html, /cybercrime\.gov\.in/);
  assert.match(html, /In development/);
  assert.match(html, /<span class="example-tag">Example<\/span>/);
  assert.match(html, /<footer/);
  assert.equal((html.match(/<h1\b/g) || []).length, 1);
});

test("the landing page never calls anything safe and makes no accuracy claim", () => {
  const html = read(path.join(webDir, "index.html"));
  const text = html
    .replace(/<script[\s\S]*?<\/script>/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/Stay safe/g, "")
    .replace(/"safe account"/g, "")
    .replace(/never means something is safe or genuine/g, "");
  assert.doesNotMatch(text, /\bsafe(ly|ty)?\b/i, "the word safe appears outside the allowed phrases");
  assert.doesNotMatch(text, /\d\s*%/, "no percentages");
  assert.doesNotMatch(text, /\b(guaranteed|accuracy|foolproof|never fails|catches every)\b/i, "no accuracy or guarantee claims");
});

test("the landing page example is the real engine's result for its text", async () => {
  const html = read(path.join(webDir, "index.html"));
  const block = html.match(/<p class="example-msg">([\s\S]*?)<\/p>/)[1];
  const text = block.replace(/<\/?mark>/g, "");
  assert.doesNotMatch(text, /[<>]/);
  const marked = [...block.matchAll(/<mark>([^<]+)<\/mark>/g)].map((m) => m[1]);

  const { bg, PAGE, H } = engine();
  const reply = await bg.handle({ type: H.MSG.SCAN_MESSAGE, payload: { text } }, PAGE);
  assert.equal(reply.ok, true, JSON.stringify(reply));
  const a = reply.result.assessment;
  assert.equal(a.category, "HIGH");
  assert.match(html, /<span class="pill pill-danger">High risk<\/span>/);
  assert.match(html, new RegExp("Warning level " + a.score + " of 100"));
  for (const r of a.reasons) assert.ok(html.includes("<li>" + r.text + "</li>"), "example is missing the reason: " + r.text);
  assert.equal(a.reasons.length, (html.match(/<div class="example-row">[\s\S]*?<ul>([\s\S]*?)<\/ul>/)[1].match(/<li>/g) || []).length);
  assert.ok(html.includes(a.recommendedAction), "the example's advice must be the engine's own advice");
  // the highlighted phrases are exactly the spans the engine marks
  const spans = reply.result.highlights.map((h) => text.slice(h.start, h.end));
  assert.equal(JSON.stringify(marked), JSON.stringify(spans));
});

// ---------------------------------------------------------------- the web bridge, run in Node

function fakeStorage() {
  const map = new Map();
  return {
    map,
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => { map.set(k, String(v)); },
    removeItem: (k) => { map.delete(k); },
  };
}

const SCRIPTS = [
  "src/shared/constants.js", "src/shared/settings.js", "src/shared/storage.js", "src/shared/url-rules.js", "src/shared/url-intel.js",
  "src/shared/risk-rules.js", "src/shared/risk-engine.js", "src/shared/message-rules.js", "src/shared/message-scan.js",
  "src/shared/upi-rules.js", "src/shared/holdy-text.js", "src/shared/holdy.js", "src/shared/upi-analyze.js", "src/shared/screenshot.js",
  "src/background/handler.js", "web/js/web-bridge.js",
];

/** Loads the page scripts, in the page's order, into a fresh sandbox that looks like a browser window. */
function loadBridge(sandboxParts) {
  const sandbox = Object.assign({ console, URL, URLSearchParams, TextEncoder, TextDecoder, setTimeout, clearTimeout }, sandboxParts);
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const file of SCRIPTS) vm.runInContext(read(path.join(root, file)), sandbox, { filename: file });
  return sandbox.Prevenza;
}

function engine() {
  const H = loadBridge({ localStorage: fakeStorage() });
  const ID = "abcdefghijklmnopabcdefghijklmnop";
  const store = H.createStore(H.web.createLocalArea(fakeStorage()));
  const bg = H.createBackground({
    store, runtimeId: ID, version: "0.1.0",
    urlIntel: H.urlIntel, messageScan: H.messageScan, riskEngine: H.riskEngine, upiAnalyze: H.upiAnalyze, screenshot: H.screenshot,
  });
  return { bg, H, PAGE: { id: ID, url: "chrome-extension://" + ID + "/x.html" } };
}

test("bridge: CHECK_URL runs the extension's own router and returns an assessment", async () => {
  const H = loadBridge({ localStorage: fakeStorage() });
  assert.equal(typeof H.messaging.send, "function");
  assert.ok(H.web && H.web.storageIsPersistent() === true);
  const reply = await H.messaging.send({ type: H.MSG.CHECK_URL, payload: { url: "http://sbi-kyc-update.xyz/login" } });
  assert.equal(reply.ok, true, JSON.stringify(reply));
  assert.equal(reply.result.ok, true);
  assert.equal(reply.assessment.status, "scanned");
  assert.ok(["HIGH", "CRITICAL"].includes(reply.assessment.category), reply.assessment.category);
  assert.ok(reply.assessment.score >= 50);
});

test("bridge: a bad payload, an unknown type and a non-object message are rejected, never thrown", async () => {
  const H = loadBridge({ localStorage: fakeStorage() });
  const bad = [
    { type: H.MSG.CHECK_URL, payload: { url: 12345 } },
    { type: H.MSG.CHECK_URL, payload: { url: "https://example.com", extra: "field" } },
    { type: H.MSG.CHECK_URL },
    { type: H.MSG.CHECK_URL, payload: null },
    { type: "NOT_A_REAL_TYPE", payload: {} },
    null, undefined, "text", 42, [],
  ];
  for (const message of bad) {
    const reply = await H.messaging.send(message);
    assert.equal(reply.ok, false, "should be rejected: " + JSON.stringify(message));
    assert.equal(typeof reply.error, "string");
  }
});

test("bridge: settings updates are sanitized, so unknown languages and fields are never kept", async () => {
  const ls = fakeStorage();
  const H = loadBridge({ localStorage: ls });
  await H.messaging.send({ type: H.MSG.UPDATE_SETTINGS, payload: { settings: { language: "klingon", evil: "<img src=x>" } } });
  const state = await H.messaging.send({ type: H.MSG.GET_STATE });
  assert.ok(["en", "hi", "ta"].includes(state.settings.language), state.settings.language);
  assert.ok(!("evil" in state.settings));
  assert.ok(![...ls.map.values()].join("").includes("klingon") && ![...ls.map.values()].join("").includes("<img"));
});

test("bridge: after a message check and a UPI check, storage holds no input text", async () => {
  const ls = fakeStorage();
  const H = loadBridge({ localStorage: ls });
  const MARK = "ZEBRA-MARKER-7391";
  const message = "Dear customer your KYC is pending " + MARK + ". Share the OTP now http://bit.ly/zq" + MARK.toLowerCase();
  const m = await H.messaging.send({ type: H.MSG.SCAN_MESSAGE, payload: { text: message } });
  assert.equal(m.ok, true, JSON.stringify(m));
  const u = await H.messaging.send({
    type: H.MSG.ANALYZE_UPI,
    payload: { upiId: "refund." + MARK.toLowerCase() + "@ybl", name: "Rahul " + MARK, amount: "4999", reason: "pay to receive refund " + MARK, qrText: "" },
  });
  assert.equal(u.ok, true, JSON.stringify(u));
  const link = await H.messaging.send({ type: H.MSG.CHECK_URL, payload: { url: "http://sbi-" + MARK.toLowerCase() + ".xyz/login" } });
  assert.equal(link.ok, true);
  // a category-only counter is recorded, as in the extension
  const rec = await H.messaging.send({ type: H.MSG.RECORD_SCAN, payload: { category: "HIGH" } });
  assert.equal(rec.ok, true, JSON.stringify(rec));

  assert.ok(ls.map.size > 0, "settings and counters should have been saved");
  const dump = JSON.stringify([...ls.map.entries()]).toLowerCase();
  for (const secret of [MARK.toLowerCase(), "refund.", "rahul", "4999", "bit.ly", "sbi-", "kyc", "otp", "dear customer"]) {
    assert.ok(!dump.includes(secret), "storage must not contain: " + secret);
  }
  for (const key of ls.map.keys()) assert.ok(key.startsWith("prevenza-web:"), "unexpected storage key " + key);
  const keys = [...ls.map.keys()].map((k) => k.replace("prevenza-web:", "")).sort();
  assert.deepEqual(keys.filter((k) => !["prevenza.schema", "prevenza.settings", "prevenza.stats"].includes(k)), [], "only settings, counters and the schema number may be stored");
});

test("bridge: a blocked localStorage falls back to memory and everything still works", async () => {
  // 1) reading the property throws (storage blocked by the browser)
  const blocked = {};
  Object.defineProperty(blocked, "localStorage", { get() { throw new Error("SecurityError: blocked"); } });
  const H1 = loadBridge(blocked);
  assert.equal(H1.web.storageIsPersistent(), false);
  const set = await H1.messaging.send({ type: H1.MSG.UPDATE_SETTINGS, payload: { settings: { elderMode: true, language: "ta" } } });
  assert.equal(set.ok, true, JSON.stringify(set));
  const state = await H1.messaging.send({ type: H1.MSG.GET_STATE });
  assert.equal(state.settings.elderMode, true);
  assert.equal(state.settings.language, "ta");
  const check = await H1.messaging.send({ type: H1.MSG.CHECK_URL, payload: { url: "https://example.com" } });
  assert.equal(check.ok, true);

  // 2) storage exists but every write fails (quota or private window)
  const full = fakeStorage();
  full.setItem = () => { throw new Error("QuotaExceededError"); };
  const H2 = loadBridge({ localStorage: full });
  const set2 = await H2.messaging.send({ type: H2.MSG.UPDATE_SETTINGS, payload: { settings: { elderMode: true } } });
  assert.equal(set2.ok, true, JSON.stringify(set2));
  assert.equal((await H2.messaging.send({ type: H2.MSG.GET_STATE })).settings.elderMode, true);
  assert.equal(H2.web.storageIsPersistent(), false);
  assert.equal(full.map.size, 0);

  // 3) no localStorage object at all
  const H3 = loadBridge({});
  assert.equal(H3.web.storageIsPersistent(), false);
  assert.equal((await H3.messaging.send({ type: H3.MSG.GET_STATE })).ok, true);
});

test("bridge: saved settings survive a new page load (same localStorage), and damaged data falls back to defaults", async () => {
  const ls = fakeStorage();
  const H1 = loadBridge({ localStorage: ls });
  await H1.messaging.send({ type: H1.MSG.UPDATE_SETTINGS, payload: { settings: { elderMode: true } } });
  const H2 = loadBridge({ localStorage: ls });
  assert.equal((await H2.messaging.send({ type: H2.MSG.GET_STATE })).settings.elderMode, true);
  ls.setItem("prevenza-web:prevenza.settings", "{not json");
  ls.setItem("prevenza-web:prevenza.stats", '{"scansTotal":"lots","__proto__":{"x":1}}');
  const H3 = loadBridge({ localStorage: ls });
  const state = await H3.messaging.send({ type: H3.MSG.GET_STATE });
  assert.equal(state.ok, true, JSON.stringify(state));
  assert.equal(state.settings.elderMode, false);
  assert.equal(typeof state.stats.scansTotal, "number");
});

// ---------------------------------------------------------------- the dev server

function rawRequest(port, target, method) {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: "127.0.0.1", port, path: target, method: method || "GET" }, (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on("error", reject);
    req.end();
  });
}

test("dev server: refuses paths that leave the repository, and serves the site with the right headers", async () => {
  const { start, resolveRequest, mimeFor, HOST } = require("../scripts/serve-web.js");
  assert.equal(HOST, "127.0.0.1");
  const { server, port } = await start(0);
  try {
    assert.equal(server.address().address, "127.0.0.1", "must listen on the loopback address only");
    const pkg = read(path.join(root, "package.json"));
    const attacks = [
      "/../package.json", "/web/../package.json", "/web/../../package.json", "/%2e%2e/package.json", "/%2E%2E/package.json",
      "/web/%2e%2e/package.json", "/web/app/../../../package.json", "/..%2fpackage.json", "/web/..%2f..%2fpackage.json",
      "/..\\package.json", "/web/..\\package.json", "/%5c..%5cpackage.json", "/%252e%252e/package.json", "/web/%00/../package.json",
      "/../", "/..", "//..//package.json",
    ];
    for (const attack of attacks) {
      const res = await rawRequest(port, attack);
      assert.ok([400, 403, 404].includes(res.status), attack + " gave status " + res.status);
      assert.ok(!res.body.toString().includes('"prevenza-scam-guard"'), attack + " leaked package.json");
    }
    assert.equal((await rawRequest(port, "/../package.json")).status, 403);
    assert.equal((await rawRequest(port, "/%2e%2e/package.json")).status, 403);
    assert.ok(pkg.length > 0);

    for (const hidden of ["/.git/config", "/.git/HEAD", "/node_modules/fast-check/package.json"]) {
      assert.equal((await rawRequest(port, hidden)).status, 404, hidden + " must not be served");
    }
    assert.equal((await rawRequest(port, "/web/app/nope.html")).status, 404);
    assert.equal((await rawRequest(port, "/web/app/check.html", "POST")).status, 405);
    assert.equal((await rawRequest(port, "/web/app/check.html", "PUT")).status, 405);

    const root302 = await rawRequest(port, "/");
    assert.equal(root302.status, 302);
    assert.equal(root302.headers.location, "/web/");

    const home = await rawRequest(port, "/web/");
    assert.equal(home.status, 200);
    assert.match(home.headers["content-type"], /^text\/html/);
    assert.match(home.body.toString(), /Pause\. Check\. Stay safe\./);
    assert.equal(home.headers["x-content-type-options"], "nosniff");
    assert.equal(home.headers["referrer-policy"], "no-referrer");
    assert.match(home.headers["content-security-policy"], /frame-ancestors 'none'/);
    assert.match(home.headers["content-security-policy"], /connect-src 'none'/);

    const css = await rawRequest(port, "/web/css/site.css?v=1");
    assert.equal(css.status, 200);
    assert.match(css.headers["content-type"], /^text\/css/);
    const png = await rawRequest(port, "/assets/icons/icon48.png");
    assert.equal(png.headers["content-type"], "image/png");
    assert.equal((await rawRequest(port, "/web/app/check.html", "HEAD")).body.length, 0);
  } finally {
    await new Promise((r) => server.close(r));
  }

  assert.match(mimeFor("tesseract-core.wasm.js"), /^text\/javascript/);
  assert.equal(mimeFor("tesseract-core.wasm"), "application/wasm");
  assert.match(mimeFor("a.js"), /^text\/javascript/);
  assert.equal(mimeFor("eng.traineddata.gz"), "application/gzip");
  assert.equal(mimeFor("unknown.bin"), "application/octet-stream");
  assert.deepEqual(resolveRequest("/../x"), { status: 403 });
  assert.deepEqual(resolveRequest("nope"), { status: 400 });
  assert.deepEqual(resolveRequest("/%zz"), { status: 400 });
});

test("dev server: every OCR file the checker page needs is served with a usable type", async () => {
  const { start } = require("../scripts/serve-web.js");
  const { server, port } = await start(0);
  try {
    const dir = path.join(root, "vendor", "tesseract");
    const files = fs.readdirSync(dir);
    assert.ok(files.length > 0);
    for (const name of files.filter((n) => n.endsWith(".js"))) {
      const res = await rawRequest(port, "/vendor/tesseract/" + name, "HEAD");
      assert.equal(res.status, 200, name);
      assert.match(res.headers["content-type"], /^text\/javascript/, name + " must be served as JavaScript");
    }
  } finally {
    await new Promise((r) => server.close(r));
  }
});

test("scripts load in an order that works: elder-text.js before holdy.js (holdy.js reads it when it loads)", () => {
  for (const file of pages) {
    const order = [...read(file).matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split("/").pop());
    const holdy = order.indexOf("holdy.js");
    if (holdy === -1) continue;
    assert.ok(order.indexOf("elder-text.js") !== -1 && order.indexOf("elder-text.js") < holdy, rel(file) + ": elder-text.js must load before holdy.js");
    assert.ok(order.indexOf("holdy-text.js") !== -1 && order.indexOf("holdy-text.js") < holdy, rel(file) + ": holdy-text.js must load before holdy.js");
    assert.ok(order.indexOf("web-bridge.js") < order.indexOf("ui.js"), rel(file) + ": the bridge must load before the UI scripts");
  }
});

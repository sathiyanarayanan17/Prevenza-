// Security and privacy tests. They read the source code and fail if a forbidden API appears.
// Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const SRC = path.join(root, "src");

function files(dir, exts, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) files(full, exts, acc);
    else if (exts.some((e) => entry.name.endsWith(e))) acc.push(full);
  }
  return acc;
}

// Remove comments so a sentence like "never calls fetch()" in a comment does not trigger a rule.
function stripComments(code) {
  return code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");
}

// Step 9 (Emergency Help) needs exactly two things the earlier steps forbade, each allowed in exactly one file:
//   1. the official reporting portal address, as data in src/shared/emergency.js (the user opens it by choice)
//   2. navigator.clipboard.writeText(...) in src/emergency/emergency.js, to copy the helpline number when the user presses a button
// Everything else in those two files is still checked. Any other external address, or any other use of the clipboard, still fails.
const OFFICIAL_PORTAL = "https://cybercrime.gov.in/";
const EMERGENCY_DATA = path.join("src", "shared", "emergency.js");
const EMERGENCY_PAGE = path.join("src", "emergency", "emergency.js");
function allowStep9(rel, code) {
  if (rel === EMERGENCY_DATA) return code.split(OFFICIAL_PORTAL).join("");
  if (rel === EMERGENCY_PAGE) return code.replace(/navigator\.clipboard\.writeText\(/g, "");
  return code;
}

const sourceFiles = files(SRC, [".js"]).map((f) => {
  const rel = path.relative(root, f);
  return { rel, raw: stripComments(fs.readFileSync(f, "utf8")), code: allowStep9(rel, stripComments(fs.readFileSync(f, "utf8"))) };
});
const pageFiles = files(SRC, [".html", ".css"]).map((f) => ({ rel: path.relative(root, f), code: fs.readFileSync(f, "utf8") }));
const content = sourceFiles.find((f) => f.rel.endsWith(path.join("content", "content.js")));

test("no network APIs anywhere in the extension", () => {
  const forbidden = [/\bfetch\s*\(/, /XMLHttpRequest/, /\bWebSocket\b/, /sendBeacon/, /\bEventSource\b/, /\bimportScripts\(\s*["']https?:/, /navigator\.connection/];
  for (const f of sourceFiles) for (const re of forbidden) assert.doesNotMatch(f.code, re, f.rel + " uses " + re);
});

test("no external URLs in source, pages or styles (only the SVG namespace is allowed)", () => {
  for (const f of [...sourceFiles, ...pageFiles]) {
    const cleaned = f.code.replace(/http:\/\/www\.w3\.org\/2000\/svg/g, "");
    assert.doesNotMatch(cleaned, /https?:\/\//i, f.rel + " contains an external URL");
    assert.doesNotMatch(cleaned, /@import|url\(\s*["']?https?:/i, f.rel + " imports remote resources");
  }
});

test("Step 9: the portal address and the clipboard are allowed in exactly one file each, and nowhere else", () => {
  const withPortal = sourceFiles.filter((f) => f.raw.includes(OFFICIAL_PORTAL)).map((f) => f.rel);
  assert.deepEqual(withPortal, [EMERGENCY_DATA]);
  const urls = sourceFiles.flatMap((f) => (f.raw.match(/https?:\/\/[^\s"'`)]+/g) || []).map((u) => f.rel + " " + u)).filter((u) => !u.includes("w3.org"));
  assert.deepEqual(urls, [EMERGENCY_DATA + " " + OFFICIAL_PORTAL]);
  const withClipboard = sourceFiles.filter((f) => /clipboard/i.test(f.raw)).map((f) => f.rel);
  assert.deepEqual(withClipboard, [EMERGENCY_PAGE]);
  const page = sourceFiles.find((f) => f.rel === EMERGENCY_PAGE);
  assert.equal((page.raw.match(/clipboard/gi) || []).length, 1, "only one clipboard call");
  assert.match(page.raw, /navigator\.clipboard\.writeText\(\s*OFFICIAL\.helplineNumber\s*\)/);
  assert.doesNotMatch(page.raw, /clipboard\.(read|readText)|execCommand/);
});

test("no dynamic code execution or unsafe HTML insertion", () => {
  const forbidden = [/\beval\s*\(/, /new\s+Function\s*\(/, /setTimeout\s*\(\s*["'`]/, /setInterval\s*\(\s*["'`]/, /\.innerHTML\b/, /\.outerHTML\b/, /insertAdjacentHTML/, /document\.write/, /javascript:/i];
  for (const f of sourceFiles) for (const re of forbidden) assert.doesNotMatch(f.code, re, f.rel + " uses " + re);
});

test("no access to cookies, history, browsing data or other powerful APIs", () => {
  const forbidden = [
    /document\.cookie/, /chrome\.cookies/, /chrome\.history/, /chrome\.bookmarks/, /chrome\.downloads/, /chrome\.webRequest/,
    /chrome\.declarativeNetRequest/, /chrome\.scripting/, /chrome\.debugger/, /chrome\.identity/, /chrome\.management/,
    /chrome\.storage\.sync/, /chrome\.storage\.session/, /getUserMedia/, /navigator\.geolocation/, /clipboard/i,
    /indexedDB/, /localStorage/, /sessionStorage/,
  ];
  for (const f of sourceFiles) for (const re of forbidden) assert.doesNotMatch(f.code, re, f.rel + " uses " + re);
});

test("settings are kept only in chrome.storage.local (never synced to an account)", () => {
  const sw = sourceFiles.find((f) => f.rel.endsWith("service-worker.js"));
  assert.match(sw.code, /chrome\.storage\.local/);
});

test("the content script never reads form fields, passwords, page text or keystrokes", () => {
  const code = content.code;
  const forbidden = [
    /password/i, /\bcard\b/i, /\bcvv\b/i, /\botp\b/i,
    /querySelector(All)?\s*\(\s*["'`][^"'`]*(input|textarea|select|form|password)/i,
    /getElementsByTagName/, /getElementsByName/, /document\.forms/, /FormData/, /\.value\b/, /\.innerText\b/, /\.textContent\b(?!\s*=[^=])/,
    /document\.body/, /document\.documentElement\.(innerText|textContent|outerHTML)/, /getSelection/, /window\.name/, /document\.referrer/,
    /addEventListener\(\s*["'](input|keydown|keyup|keypress|change|paste|copy|cut|submit|beforeinput)["']/,
  ];
  for (const re of forbidden) assert.doesNotMatch(code, re, "content.js uses " + re);
});

test("the content script reads only the hostname and protocol of the page", () => {
  const reads = content.code.match(/location\.[a-zA-Z]+/g) || [];
  const allowed = new Set(["location.hostname", "location.protocol"]);
  for (const r of reads) assert.ok(allowed.has(r), "content.js reads " + r);
  assert.ok(reads.length >= 2);
});

test("the content script only answers messages from this extension", () => {
  assert.match(content.code, /sender\.id\s*!==\s*chrome\.runtime\.id/);
});

test("the content script is silent by default (no always-on UI)", () => {
  const C = require("../src/shared/constants.js");
  assert.equal(C.DEFAULT_SETTINGS.showAssistantBadge, false);
  assert.match(content.code, /if \(!wantBadge && !bubbleOpen\)/);
});

test("storage never records page addresses or text", () => {
  const storage = sourceFiles.find((f) => f.rel.endsWith(path.join("shared", "storage.js")));
  const handler = sourceFiles.find((f) => f.rel.endsWith(path.join("background", "handler.js")));
  for (const f of [storage, handler]) {
    assert.doesNotMatch(f.code, /sender\.url[^;]*(set|save|store)/i, f.rel);
    assert.doesNotMatch(f.code, /message\.(url|text|href|html)\b/i, f.rel);
  }
});

test("no analytics or tracking vocabulary in the source", () => {
  for (const f of sourceFiles) assert.doesNotMatch(f.code, /analytics|telemetry|tracking|gtag|mixpanel|sentry/i, f.rel);
});

// Step 12: reading a QR code in a chosen screenshot, on the device. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const Q = require("../src/shared/qr-text.js");

const root = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const stripComments = (code) => code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1");

test("classify: a UPI code goes to the UPI checker, a web address to the link checker, anything else nowhere", () => {
  const upi = Q.classify("  upi://pay?pa=shop@ybl&pn=Shop&am=20 \n");
  assert.equal(upi.kind, "upi");
  assert.equal(upi.text, "upi://pay?pa=shop@ybl&pn=Shop&am=20");
  assert.equal(upi.button, "Check this QR payment");
  assert.match(upi.notice, /read on this device/);
  assert.match(upi.notice, /Do not trust it/);
  assert.equal(Q.classify("UPI://PAY?pa=a@b").kind, "upi");

  const link = Q.classify("https://sbi-kyc-update.xyz/login");
  assert.equal(link.kind, "link");
  assert.equal(link.text, "https://sbi-kyc-update.xyz/login");

  for (const other of ["WIFI:S:home;T:WPA;P:secret;;", "BEGIN:VCARD\nFN:Ravi\nEND:VCARD", "hello world", "https://two words.com"]) {
    const r = Q.classify(other);
    assert.equal(r.kind, "other", other);
    assert.equal(r.text, "", "text that is not checked is not passed on: " + other);
    assert.equal(r.button, "");
  }
  for (const empty of ["", "   ", null, undefined, 42, {}, "\u0000\u0007"]) assert.equal(Q.classify(empty).kind, "empty");
});

test("classify: control characters are removed and lengths are limited to what each checker accepts", () => {
  assert.equal(Q.classify("upi://pay?pa=a@b\u0000\u0008&am=1").text, "upi://pay?pa=a@b&am=1");
  const long = Q.classify("upi://pay?pa=a@b&tn=" + "x".repeat(2000));
  assert.equal(long.text.length, Q.MAX_UPI);
  assert.equal(long.truncated, true);
  // a cut-off web address would be a different address, so a very long one is not passed on
  assert.equal(Q.classify("https://example.com/" + "a".repeat(3000)).kind, "other");
});

test("a real QR picture round-trips through the bundled reader into the UPI checker's format", async () => {
  const QR = require("qrcode");
  const { PNG } = require("pngjs");
  const jsQR = require("../vendor/jsqr/jsQR.js");
  const payload = "upi://pay?pa=refund.helpdesk@ybl&pn=Customer%20Care%20Refund&am=4999&tn=Pay%20to%20receive%20refund";
  const img = PNG.sync.read(await QR.toBuffer(payload, { width: 360, margin: 2 }));
  const code = jsQR(new Uint8ClampedArray(img.data), img.width, img.height);
  assert.ok(code, "the bundled reader found the QR code");
  const r = Q.classify(code.data);
  assert.equal(r.kind, "upi");
  assert.equal(r.text, payload);
  // and the UPI checker understands it
  const upi = require("../src/shared/upi-analyze.js");
  const messageScan = require("../src/shared/message-scan.js");
  const result = upi.analyzeUpi({ qrText: r.text }, { messageScan });
  assert.equal(result.ok, true);
  assert.equal(result.qr.recipient, "refund.helpdesk@ybl");
});

test("the bundled QR library is the published jsQR 1.4.0, unmodified, with its licence, and has no network or eval", () => {
  const vendored = fs.readFileSync(path.join(root, "vendor", "jsqr", "jsQR.js"));
  const published = fs.readFileSync(require.resolve("jsqr/dist/jsQR.js"));
  assert.ok(vendored.equals(published), "vendor/jsqr/jsQR.js must be an exact copy of the jsqr package");
  assert.equal(require("jsqr/package.json").version, "1.4.0");
  assert.match(read("vendor", "jsqr", "LICENSE"), /Apache License/);
  const code = stripComments(vendored.toString("utf8"));
  for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\beval\s*\(/, /new Function\b/, /importScripts/, /innerHTML/, /localStorage|indexedDB/]) {
    assert.doesNotMatch(code, re, "jsQR uses " + re);
  }
});

test("the page script reads only the chosen picture, loads only the bundled library, stores nothing and never uses a camera", () => {
  const code = stripComments(read("src", "dashboard", "qr-reader.js"));
  assert.match(code, /const LIB = "\.\.\/\.\.\/vendor\/jsqr\/jsQR\.js";/);
  assert.equal((code.match(/\.src = /g) || []).length, 1, "one script address, the bundled library");
  for (const re of [/getUserMedia|mediaDevices|capture/, /chrome\.storage|localStorage|sessionStorage|indexedDB/, /\bfetch\s*\(|XMLHttpRequest|sendBeacon/, /innerHTML|outerHTML|insertAdjacentHTML/, /H\.messaging/, /\.click\(\)|requestSubmit|\.submit\(/]) {
    assert.doesNotMatch(code, re, "qr-reader.js uses " + re);
  }
  assert.match(code, /bitmap\.close\(\)/, "the decoded picture is released");
  assert.match(code, /validateImage\(/, "the same file checks as the screenshot checker");
});

test("both checker pages load the QR reader, and the UPI section still has no file picker or camera", () => {
  for (const file of [["src", "dashboard", "dashboard.html"], ["web", "app", "check.html"]]) {
    const html = read(...file);
    const name = file.join("/");
    const scripts = [...html.matchAll(/<script src="([^"]+)"/g)].map((m) => m[1].split("/").pop());
    assert.ok(scripts.indexOf("qr-text.js") > -1 && scripts.indexOf("qr-text.js") < scripts.indexOf("qr-reader.js"), name);
    assert.ok(scripts.indexOf("screenshot.js") < scripts.indexOf("qr-reader.js"), name);
    const shot = html.slice(html.indexOf('id="screenshot-check"'));
    for (const id of ["shot-qr", "shot-qr-text", "shot-qr-use"]) assert.equal((html.match(new RegExp('id="' + id + '"', "g")) || []).length, 1, name + " #" + id);
    assert.match(shot, /id="shot-qr" hidden/);
    const upi = html.slice(html.indexOf('id="upi-check"'), html.indexOf('id="screenshot-check"'));
    assert.doesNotMatch(upi, /type="file"|capture=/i, name);
    assert.match(upi, /does not use your camera/);
    assert.match(upi, /href="#screenshot-check"/);
  }
});

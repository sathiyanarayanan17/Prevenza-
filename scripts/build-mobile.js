#!/usr/bin/env node
/*
 * Builds mobile/www/ for the Android app (Capacitor). Nothing is bundled or rewritten, apart from two small changes to
 * the COPIED files: a start page that opens the checker, and the "Share to Prevenza" script added to the copied checker
 * page. The detection code is never duplicated in the repository: this script copies it at build time, with the same
 * relative paths, so every page works unchanged. mobile/www/ is generated and ignored by git.
 *
 *   node scripts/build-mobile.js        (or: cd mobile && npm run build)
 */
"use strict";
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const OUT = path.join(ROOT, "mobile", "www");

// What the app needs, as paths inside the repository. A trailing slash means a whole folder.
const COPY = [
  "web/",
  "src/shared/",
  "src/background/handler.js",
  "src/dashboard/dashboard.css",
  "src/dashboard/ocr-runner.js",
  "src/emergency/",
  "vendor/tesseract/",
  "assets/icons/",
];
const COPY_PATTERNS = [{ dir: "src/dashboard", match: /-check\.js$/ }];

// Mobile-only files (they never go into web/, so the website is unchanged).
const OVERLAY = [["mobile/overlay/share-target.js", "web/js/share-target.js"]];
const START_PAGE = "web/app/check.html";
const SHARE_TAG = '  <script src="../js/share-target.js"></script>\n';

function copyFile(from, to) {
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
}

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(src, dst);
    else if (entry.isFile()) copyFile(src, dst);
  }
}

function build() {
  // Only ever delete the generated folder, and only if it really is mobile/www.
  if (path.relative(ROOT, OUT).split(path.sep).join("/") !== "mobile/www") throw new Error("unexpected output folder");
  fs.rmSync(OUT, { recursive: true, force: true });
  fs.mkdirSync(OUT, { recursive: true });

  for (const item of COPY) {
    const from = path.join(ROOT, item);
    if (!fs.existsSync(from)) throw new Error("missing: " + item);
    if (item.endsWith("/")) copyDir(from, path.join(OUT, item));
    else copyFile(from, path.join(OUT, item));
  }
  for (const { dir, match } of COPY_PATTERNS) {
    for (const name of fs.readdirSync(path.join(ROOT, dir)).filter((n) => match.test(n))) copyFile(path.join(ROOT, dir, name), path.join(OUT, dir, name));
  }
  for (const [from, to] of OVERLAY) copyFile(path.join(ROOT, from), path.join(OUT, to));

  // The checker page gets the share script, after the checkers it fills in.
  const startFile = path.join(OUT, START_PAGE);
  let html = fs.readFileSync(startFile, "utf8");
  const last = '<script src="../../src/dashboard/screenshot-check.js"></script>';
  if (!html.includes(last)) throw new Error("check.html no longer ends with screenshot-check.js; update scripts/build-mobile.js");
  html = html.replace(last, last + "\n" + SHARE_TAG.replace(/\n$/, ""));
  fs.writeFileSync(startFile, html);

  // Capacitor opens www/index.html. It goes straight to the checker (a plain redirect, no script).
  fs.writeFileSync(
    path.join(OUT, "index.html"),
    '<!doctype html>\n<html lang="en"><head><meta charset="utf-8">\n' +
      "<meta http-equiv=\"Content-Security-Policy\" content=\"default-src 'self'; connect-src 'none'\">\n" +
      '<meta http-equiv="refresh" content="0; url=' + START_PAGE + '">\n<title>Prevenza</title></head>\n' +
      '<body><p><a href="' + START_PAGE + '">Open Prevenza</a></p></body></html>\n'
  );

  verify();
}

/** Every file a page of the app (web/ and the start page) points to must exist in the copy, so a missing file fails the build, not the user. */
function verify() {
  let pages = 0;
  const walk = (dir, topOnly) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { if (!topOnly) walk(full); }
      else if (entry.name.endsWith(".html")) {
        pages++;
        const html = fs.readFileSync(full, "utf8");
        for (const m of html.matchAll(/\s(?:src|href)="([^"#]*)(?:#[^"]*)?"/g)) {
          const value = m[1];
          if (!value || /^(https?:|data:)/.test(value)) continue;
          const target = path.resolve(path.dirname(full), value.split("?")[0]);
          if (!fs.existsSync(target)) throw new Error(path.relative(OUT, full) + " points to a missing file: " + value);
        }
      }
    }
  };
  walk(path.join(OUT, "web"));
  walk(OUT, true);
  return pages;
}

if (require.main === module) {
  try {
    build();
    const size = (function total(dir) {
      return fs.readdirSync(dir, { withFileTypes: true }).reduce((n, e) => n + (e.isDirectory() ? total(path.join(dir, e.name)) : fs.statSync(path.join(dir, e.name)).size), 0);
    })(OUT);
    console.log("mobile/www built: " + (size / 1048576).toFixed(1) + " MB. Start page: " + START_PAGE);
  } catch (e) {
    console.error("Build failed: " + e.message);
    process.exit(1);
  }
}

module.exports = { build, verify, OUT, COPY, START_PAGE };

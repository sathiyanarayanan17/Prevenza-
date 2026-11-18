// The Android app (mobile/): permissions, share target, generated files and "one copy of the logic". Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const read = (...p) => fs.readFileSync(path.join(root, ...p), "utf8");
const MANIFEST = read("mobile", "android", "app", "src", "main", "AndroidManifest.xml").replace(/<!--[\s\S]*?-->/g, "");
const JAVA_DIR = path.join(root, "mobile", "android", "app", "src", "main", "java", "app", "prevenza", "scamguard");

test("android manifest: no permissions at all (no INTERNET, SMS, contacts, storage, camera or microphone)", () => {
  assert.doesNotMatch(MANIFEST, /<uses-permission/);
  assert.doesNotMatch(MANIFEST, /<uses-feature/);
  assert.doesNotMatch(MANIFEST, /INTERNET|READ_SMS|RECEIVE_SMS|READ_CONTACTS|CAMERA|RECORD_AUDIO|STORAGE|MANAGE_EXTERNAL/);
});

test("android manifest: no cleartext traffic, no backups, and only the main screen is exported", () => {
  assert.doesNotMatch(MANIFEST, /usesCleartextTraffic="true"/);
  assert.match(MANIFEST, /android:allowBackup="false"/);
  const exported = [...MANIFEST.matchAll(/android:exported="true"/g)].length;
  assert.equal(exported, 1, "only MainActivity may be exported");
  assert.doesNotMatch(MANIFEST, /<(service|receiver)\b/);
});

test("android manifest: 'Share to Prevenza' accepts text and images only", () => {
  const filters = [...MANIFEST.matchAll(/<intent-filter>([\s\S]*?)<\/intent-filter>/g)].map((m) => m[1]);
  const send = filters.filter((f) => /android\.intent\.action\.SEND"/.test(f));
  assert.equal(send.length, 2);
  const types = send.map((f) => f.match(/android:mimeType="([^"]+)"/)[1]).sort();
  assert.deepEqual(types, ["image/*", "text/plain"]);
  for (const f of send) assert.match(f, /android\.intent\.category\.DEFAULT/);
  assert.doesNotMatch(MANIFEST, /SEND_MULTIPLE|android\.intent\.action\.VIEW|<data android:scheme/);
});

test("capacitor config: bundled files only, no remote server", () => {
  const cfg = JSON.parse(read("mobile", "capacitor.config.json"));
  assert.equal(cfg.webDir, "www");
  assert.ok(!cfg.server || (!cfg.server.url && !cfg.server.cleartext));
  assert.notEqual(cfg.android && cfg.android.allowMixedContent, true);
  assert.match(cfg.appId, /^[a-z]+(\.[a-z]+)+$/);
});

test("mobile dependencies are pinned to exact versions", () => {
  const pkg = JSON.parse(read("mobile", "package.json"));
  const all = Object.assign({}, pkg.dependencies, pkg.devDependencies);
  assert.ok(Object.keys(all).length >= 3);
  for (const [name, version] of Object.entries(all)) assert.match(version, /^\d+\.\d+\.\d+$/, name + " must be pinned exactly, not " + version);
  assert.equal(all["@capacitor/core"], all["@capacitor/android"]);
  assert.equal(all["@capacitor/core"], all["@capacitor/cli"]);
});

test("mobile/www is generated and ignored by git", () => {
  assert.match(read(".gitignore"), /^mobile\/www\/$/m);
});

test("native share code: no network, no files written, no logging, content never sent anywhere", () => {
  const files = fs.readdirSync(JAVA_DIR).filter((f) => f.endsWith(".java"));
  assert.deepEqual(files.sort(), ["MainActivity.java", "ShareTargetPlugin.java"]);
  for (const f of files) {
    const code = fs.readFileSync(path.join(JAVA_DIR, f), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.doesNotMatch(code, /HttpURLConnection|okhttp|java\.net|Socket|new URL\(|loadUrl|evaluateJavascript|WebView/i, f + " uses the network or the web view directly");
    assert.doesNotMatch(code, /FileOutputStream|FileWriter|openFileOutput|getExternal|SharedPreferences|SQLite|Files\.write/, f + " writes to storage");
    assert.doesNotMatch(code, /\bLog\.|System\.out|printStackTrace|Toast/, f + " logs or shows shared content");
  }
  const plugin = fs.readFileSync(path.join(JAVA_DIR, "ShareTargetPlugin.java"), "utf8");
  assert.match(plugin, /MAX_IMAGE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(plugin, /ACTION_SEND/);
});

test("share script: no network, eval or innerHTML, and it only fills inputs (never checks by itself)", () => {
  const code = read("mobile", "overlay", "share-target.js");
  for (const re of [/\bfetch\s*\(/, /XMLHttpRequest/, /WebSocket/, /sendBeacon/, /\beval\s*\(/, /new Function/, /innerHTML|outerHTML|insertAdjacentHTML|document\.write/, /localStorage|sessionStorage|indexedDB|document\.cookie/]) {
    assert.doesNotMatch(code, re, "share-target.js uses " + re);
  }
  assert.doesNotMatch(code, /\.click\(|requestSubmit|\.submit\(/, "the user must press the check button");
});

test("build: copies the app files with the same relative paths, with no second copy of the logic", () => {
  const { build, OUT, COPY, START_PAGE } = require("../scripts/build-mobile.js");
  build();
  const mustHave = [
    "index.html", "web/index.html", "web/app/check.html", "web/app/emergency.html", "web/js/web-bridge.js", "web/js/check-page.js",
    "web/js/share-target.js", "src/shared/risk-engine.js", "src/shared/message-scan.js", "src/shared/url-intel.js", "src/shared/upi-analyze.js",
    "src/background/handler.js", "src/dashboard/dashboard.css", "src/dashboard/message-check.js", "src/dashboard/upi-check.js",
    "src/dashboard/screenshot-check.js", "src/dashboard/ocr-runner.js", "src/dashboard/qr-reader.js", "src/shared/qr-text.js", "vendor/jsqr/jsQR.js", "src/emergency/emergency.js", "assets/icons/icon48.png",
  ];
  for (const f of mustHave) assert.ok(fs.existsSync(path.join(OUT, f)), "mobile/www is missing " + f);
  assert.ok(fs.readdirSync(path.join(OUT, "vendor", "tesseract")).length > 0);
  assert.equal(START_PAGE, "web/app/check.html");
  assert.ok(COPY.includes("src/background/handler.js"));

  // Copies are byte-for-byte the originals, apart from the checker page (it gets the share script).
  for (const f of ["src/background/handler.js", "src/shared/risk-engine.js", "src/shared/message-scan.js", "web/js/web-bridge.js", "web/index.html", "src/dashboard/ocr-runner.js"]) {
    assert.ok(fs.readFileSync(path.join(OUT, f)).equals(fs.readFileSync(path.join(root, f))), f + " must be an exact copy");
  }
  const original = read("web", "app", "check.html");
  const copy = fs.readFileSync(path.join(OUT, "web", "app", "check.html"), "utf8");
  assert.equal(copy.replace(/\r?\n\s*<script src="\.\.\/js\/share-target\.js"><\/script>/, ""), original);
  assert.match(copy, /screenshot-check\.js"><\/script>\s*<script src="\.\.\/js\/share-target\.js"><\/script>/);
  assert.match(copy, /connect-src 'none'/);
  assert.match(fs.readFileSync(path.join(OUT, "index.html"), "utf8"), /url=web\/app\/check\.html/);
  assert.doesNotMatch(fs.readFileSync(path.join(OUT, "index.html"), "utf8"), /<script/);

  // The repository itself has exactly one copy of the logic (the generated mobile/www and node_modules are not source).
  const found = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "www", "build"].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (full.includes(path.join("mobile", "android", "app", "src", "main", "assets"))) continue; // generated copy of www
      if (e.isDirectory()) walk(full);
      else if (["handler.js", "risk-engine.js", "message-scan.js", "url-intel.js"].includes(e.name)) found.push(path.relative(root, full).split(path.sep).join("/"));
    }
  })(root);
  assert.deepEqual(found.sort(), ["src/background/handler.js", "src/shared/message-scan.js", "src/shared/risk-engine.js", "src/shared/url-intel.js"]);
});

// Step 12: the app opens the checker directly, and release signing never puts a key or password in the repository.
test("capacitor config: the app starts on the checker page, with no redirect page in between", () => {
  const cfg = JSON.parse(read("mobile", "capacitor.config.json"));
  assert.equal(cfg.server.appStartPath, "/web/app/check.html");
  assert.ok(fs.existsSync(path.join(root, "web", "app", "check.html")));
});

test("release signing reads the key from outside the repository, and no key or password is committed", () => {
  const gradle = read("mobile", "android", "app", "build.gradle");
  assert.match(gradle, /PREVENZA_KEYSTORE_PROPERTIES/);
  assert.match(gradle, /\.prevenza-signing\/keystore\.properties/);
  assert.match(gradle, /if \(signingProps\.getProperty\("storeFile"\)\)/, "without the file, release builds stay unsigned");
  assert.doesNotMatch(gradle, /storePassword\s+["']|keyPassword\s+["']/, "no password written in the build file");
  const ignore = read(".gitignore");
  for (const rule of ["*.jks", "*.keystore", "keystore.properties"]) assert.ok(ignore.split(/\r?\n/).includes(rule), ".gitignore needs " + rule);
  const found = [];
  (function walk(dir) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (["node_modules", ".git", "build", ".gradle"].includes(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(jks|keystore|p12)$|^keystore\.properties$/.test(e.name)) found.push(path.relative(root, full));
    }
  })(root);
  assert.deepEqual(found, [], "signing files must not be inside the project");
});

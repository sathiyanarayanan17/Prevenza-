// Manifest and extension-loading requirements. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const root = path.join(__dirname, "..");
const manifest = JSON.parse(fs.readFileSync(path.join(root, "manifest.json"), "utf8"));
const exists = (rel) => fs.existsSync(path.join(root, rel));

function pngSize(rel) {
  const buf = fs.readFileSync(path.join(root, rel));
  assert.equal(buf.subarray(1, 4).toString(), "PNG", rel + " is not a PNG file");
  return { w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
}

test("manifest is valid JSON with the required Manifest V3 fields", () => {
  assert.equal(manifest.manifest_version, 3);
  assert.equal(typeof manifest.name, "string");
  assert.match(manifest.version, /^\d+(\.\d+){1,3}$/);
  assert.ok(manifest.description.length > 0 && manifest.description.length <= 132, "description must be 1-132 characters");
});

test("branding is Prevenza: Scam Guard", () => {
  assert.equal(manifest.name, "Prevenza: Scam Guard");
  assert.equal(manifest.short_name, "Prevenza");
  assert.equal(manifest.action.default_title, "Prevenza: Scam Guard");
});

test("requests only the 'storage' permission and no host access", () => {
  assert.deepEqual(manifest.permissions, ["storage"]);
  for (const key of ["host_permissions", "optional_permissions", "optional_host_permissions", "externally_connectable", "web_accessible_resources", "commands", "devtools_page"]) {
    assert.equal(manifest[key], undefined, key + " must not be declared in Step 1");
  }
});

test("content script runs only on http and https pages, top frame only", () => {
  assert.equal(manifest.content_scripts.length, 1);
  const cs = manifest.content_scripts[0];
  assert.deepEqual(cs.matches, ["http://*/*", "https://*/*"]);
  assert.equal(cs.all_frames, false);
  assert.equal(cs.run_at, "document_idle");
  assert.ok(!cs.matches.some((m) => /<all_urls>|file:|\*:\/\//.test(m)));
});

test("every file the manifest points to exists", () => {
  const files = [
    manifest.background.service_worker,
    manifest.action.default_popup,
    manifest.options_ui.page,
    ...Object.values(manifest.icons),
    ...Object.values(manifest.action.default_icon),
    ...manifest.content_scripts.flatMap((c) => c.js),
  ];
  for (const f of files) assert.ok(exists(f), "missing file: " + f);
  assert.ok(exists("src/dashboard/dashboard.html"), "missing dashboard page");
});

test("icons are real PNG files at the declared sizes", () => {
  for (const [size, rel] of Object.entries(manifest.icons)) {
    const { w, h } = pngSize(rel);
    assert.equal(w, Number(size), rel + " width");
    assert.equal(h, Number(size), rel + " height");
  }
});

test("background is a classic service worker (works with importScripts)", () => {
  assert.equal(manifest.background.type, undefined);
  const code = fs.readFileSync(path.join(root, manifest.background.service_worker), "utf8");
  assert.match(code, /importScripts\(/);
  assert.match(code, /chrome\.runtime\.onMessage\.addListener/);
});

test("content security policy is strict and blocks network access", () => {
  const csp = manifest.content_security_policy.extension_pages;
  assert.match(csp, /script-src 'self'/);
  assert.match(csp, /connect-src 'none'/);
  assert.match(csp, /object-src 'none'/);
  // Step 6: the offline OCR engine is WebAssembly, which needs 'wasm-unsafe-eval'. That keyword allows compiling WebAssembly
  // only. JavaScript eval, inline scripts and every remote source stay forbidden, so the strict check applies to the rest.
  assert.equal((csp.match(/'wasm-unsafe-eval'/g) || []).length, 1, "'wasm-unsafe-eval' may appear once");
  assert.match(csp, /script-src 'self' 'wasm-unsafe-eval';/, "and only in script-src");
  assert.doesNotMatch(csp.replace(/'wasm-unsafe-eval'/g, ""), /unsafe-eval|unsafe-inline|https?:|\*/);
});

test("extension pages need no inline scripts, inline handlers or inline styles (CSP-safe)", () => {
  const pages = ["src/popup/popup.html", "src/settings/settings.html", "src/dashboard/dashboard.html"];
  for (const rel of pages) {
    const html = fs.readFileSync(path.join(root, rel), "utf8");
    assert.doesNotMatch(html, /<script(?![^>]*\bsrc=)[^>]*>/i, rel + " has an inline script");
    assert.doesNotMatch(html, /\son[a-z]+\s*=/i, rel + " has an inline event handler");
    assert.doesNotMatch(html, /\sstyle\s*=/i, rel + " has an inline style attribute");
    assert.doesNotMatch(html, /<style[\s>]/i, rel + " has an inline <style> block");
    // every linked script and stylesheet exists
    for (const m of html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)) {
      const target = path.normalize(path.join(path.dirname(path.join(root, rel)), m[1]));
      assert.ok(fs.existsSync(target), rel + " links to a missing file: " + m[1]);
    }
    assert.match(html, /<meta name="viewport"/, rel + " needs a viewport tag for responsive layout");
  }
});

test("minimum Chrome version is set for Manifest V3 features used", () => {
  assert.ok(Number(manifest.minimum_chrome_version) >= 110);
});

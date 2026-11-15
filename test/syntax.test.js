// JavaScript syntax check for every source, script and test file. Run with: npm test
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");

const root = path.join(__dirname, "..");

function jsFiles(dir, acc = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".git"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) jsFiles(full, acc);
    else if (entry.name.endsWith(".js")) acc.push(full);
  }
  return acc;
}

test("every JavaScript file parses without syntax errors", () => {
  const files = jsFiles(root);
  assert.ok(files.length >= 14, "expected at least 14 JavaScript files, found " + files.length);
  for (const file of files) {
    const code = fs.readFileSync(file, "utf8");
    assert.doesNotThrow(() => new vm.Script(code, { filename: file }), "syntax error in " + path.relative(root, file));
  }
});

test("source files use strict mode or a module wrapper (no accidental globals)", () => {
  const src = jsFiles(path.join(root, "src"));
  for (const file of src) {
    const code = fs.readFileSync(file, "utf8");
    const ok = /["']use strict["']/.test(code) || /\(function \(root, factory\)/.test(code) || /importScripts\(/.test(code);
    assert.ok(ok, path.relative(root, file) + " should use strict mode or the shared module wrapper");
  }
});

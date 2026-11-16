// Copies the offline OCR engine and its language data from node_modules into vendor/tesseract/.
// Run once after `npm install`, and again only if the pinned versions in package.json change:  npm run ocr:assets
//
// Nothing is downloaded here and nothing is loaded from the internet at run time. The extension loads these local files only:
//   tesseract.min.js          the OCR library (main thread)
//   worker.min.js             the OCR worker
//   tesseract-core-simd-lstm.wasm.js   the OCR engine (WebAssembly, embedded in the script)
//   lang-eng.js, lang-hin.js, lang-tam.js   language data, as text the page can read without a network request
const fs = require("fs");
const path = require("path");

const root = path.join(__dirname, "..");
const nm = (...p) => path.join(root, "node_modules", ...p);
const out = path.join(root, "vendor", "tesseract");
fs.mkdirSync(out, { recursive: true });

const pkg = (name) => JSON.parse(fs.readFileSync(nm(...name.split("/"), "package.json"), "utf8"));
const copy = (from, to) => fs.copyFileSync(from, path.join(out, to));

copy(nm("tesseract.js", "dist", "tesseract.min.js"), "tesseract.min.js");
copy(nm("tesseract.js", "dist", "worker.min.js"), "worker.min.js");
copy(nm("tesseract.js-core", "tesseract-core-simd-lstm.wasm.js"), "tesseract-core-simd-lstm.wasm.js");
copy(nm("tesseract.js", "LICENSE.md"), "LICENSE-tesseract.js.txt");
copy(nm("tesseract.js-core", "LICENSE"), "LICENSE-tesseract.js-core.txt");

// Language data (LSTM, 8-bit "best_int" models, gzip). Wrapped in a script so the page can read it with no network request.
const langs = { eng: "English", hin: "Hindi", tam: "Tamil" };
for (const code of Object.keys(langs)) {
  const file = nm("@tesseract.js-data", code, "4.0.0_best_int", code + ".traineddata.gz");
  const b64 = fs.readFileSync(file).toString("base64");
  fs.writeFileSync(path.join(out, "lang-" + code + ".js"), "(self.PrevenzaOcrData=self.PrevenzaOcrData||{})." + code + '="' + b64 + '";\n');
}

const notice = [
  "Prevenza bundles these open-source components for offline text reading (OCR). Nothing is loaded from the internet.",
  "",
  "tesseract.js " + pkg("tesseract.js").version + " (Apache-2.0)",
  "tesseract.js-core " + pkg("tesseract.js-core").version + " (Apache-2.0)",
  ...Object.entries(langs).map(([c, n]) => "@tesseract.js-data/" + c + " " + pkg("@tesseract.js-data/" + c).version + " (" + n + " model, tessdata best_int, Apache-2.0)"),
  "",
  "Regenerate with: npm run ocr:assets",
  "",
].join("\n");
fs.writeFileSync(path.join(out, "NOTICE.txt"), notice);

let total = 0;
for (const f of fs.readdirSync(out)) {
  const size = fs.statSync(path.join(out, f)).size;
  total += size;
  console.log(f.padEnd(40), (size / 1048576).toFixed(2) + " MB");
}
console.log("total".padEnd(40), (total / 1048576).toFixed(2) + " MB");

/*
 * Prevenza: offline text reading (OCR) for the screenshot checker (Step 6).
 *
 * Everything runs on this device. The engine (Tesseract compiled to WebAssembly), its worker and the language data are
 * files inside the extension (vendor/tesseract/). Every path below is a local chrome-extension address, and the page's
 * security policy (connect-src 'none') would block an internet request anyway.
 *
 * Nothing is kept. Each run starts a fresh worker, reads the image bytes it was given, returns the text, and then ends the
 * worker so the engine, the language data and the image are released. Nothing is saved to storage or to the browser cache.
 */
(function () {
  "use strict";
  const H = (self.Prevenza = self.Prevenza || {});
  const BASE = "../../vendor/tesseract/";
  const OEM_LSTM_ONLY = 1;

  /** Adds a <script> for one of the bundled files. The files are local, so this is not a network request. */
  function loadScript(file) {
    return new Promise((resolve, reject) => {
      const tag = document.createElement("script");
      tag.src = BASE + file;
      tag.onload = () => resolve(tag);
      tag.onerror = () => reject(new Error("A bundled OCR file could not be loaded: " + file));
      document.head.appendChild(tag);
    });
  }

  function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  const absolute = (file) => new URL(BASE + file, location.href).href;

  /** Maps the engine's progress messages to one 0-100 bar with a plain-language label. */
  function progressFor(message) {
    const p = typeof message.progress === "number" ? message.progress : 0;
    switch (message.status) {
      case "loading tesseract core":
        return { percent: 8 + p * 17, text: "Starting the reader" };
      case "initializing tesseract":
        return { percent: 25 + p * 5, text: "Starting the reader" };
      case "loading language traineddata":
        return { percent: 30 + p * 15, text: "Loading the language" };
      case "initializing api":
        return { percent: 45 + p * 5, text: "Getting ready" };
      case "recognizing text":
        return { percent: 50 + p * 50, text: "Reading the text" };
      default:
        return null;
    }
  }

  /**
   * Reads the text in an image.
   * bytes: Uint8Array of a PNG or JPEG. codes: for example ["eng"] or ["hin", "eng"].
   * onProgress({ percent, text }) is called as work proceeds. Returns { text, confidence }.
   */
  async function run(bytes, codes, onProgress) {
    const report = typeof onProgress === "function" ? onProgress : () => undefined;
    report({ percent: 3, text: "Getting ready" });

    const tags = [];
    let worker = null;
    let failure = null;
    try {
      tags.push(await loadScript("tesseract.min.js"));
      for (const code of codes) tags.push(await loadScript("lang-" + code + ".js"));
      report({ percent: 6, text: "Getting ready" });

      // The language data arrives as text inside a script, so no file has to be fetched. It is decoded here, handed to the
      // worker, and the text copy is dropped straight away.
      const langs = codes.map((code) => ({ code, data: base64ToBytes(self.PrevenzaOcrData[code]) }));
      codes.forEach((code) => {
        delete self.PrevenzaOcrData[code];
      });

      // Workaround for tesseract.js 7.0.0 (pinned exactly): it accepts { code, data } objects when it LOADS a language, but its
      // later "initialize" step joins each object's data field instead of its code, and then looks for a file with that name.
      // Both steps share this one array, and the worker already holds its own copy of the bytes once loading has started, so
      // after loading starts the objects are swapped for plain language codes. A real-browser check covers this.
      let swapped = false;
      const swapToCodes = () => {
        if (swapped) return;
        swapped = true;
        for (let i = 0; i < langs.length; i++) langs[i] = codes[i];
      };

      worker = await self.Tesseract.createWorker(langs, OEM_LSTM_ONLY, {
        workerPath: absolute("worker.min.js"),
        corePath: absolute("tesseract-core-simd-lstm.wasm.js"),
        workerBlobURL: false, // start the worker straight from the extension's own file
        cacheMethod: "none", // never write language data or anything else to the browser's storage
        logger: (m) => {
          if (m.status === "loading language traineddata") swapToCodes();
          const step = progressFor(m);
          if (step) report(step);
        },
        errorHandler: (err) => {
          failure = err;
        },
      });
      const result = await worker.recognize(bytes);
      return { text: String(result.data.text || ""), confidence: typeof result.data.confidence === "number" ? result.data.confidence : null };
    } catch (e) {
      throw new Error(typeof failure === "string" ? failure : (e && e.message) || String(e));
    } finally {
      if (worker) {
        try {
          await worker.terminate();
        } catch (e) {
          /* the worker is already gone */
        }
      }
      // Drop the scripts and any language text that was not decoded, so nothing large stays in memory.
      tags.forEach((t) => t.remove());
      codes.forEach((code) => {
        if (self.PrevenzaOcrData) delete self.PrevenzaOcrData[code];
      });
    }
  }

  H.ocr = { run };
})();

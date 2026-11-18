/*
 * Prevenza: read a QR code in the screenshot the user chose (Step 12).
 *
 * When a picture is chosen in "Scan a screenshot", this looks for a QR code in it too. The picture is decoded on this
 * device by the bundled jsQR library (vendor/jsqr, Apache-2.0), which is loaded only when a picture is chosen. Nothing
 * is uploaded or stored, and the camera is never used. If a UPI payment code (or a web address) is found, a button puts
 * its text into the UPI checker (or the link checker). The user still presses the check button there.
 */
(function () {
  "use strict";
  const H = self.Prevenza;
  const $ = (id) => document.getElementById(id);
  const input = $("shot-file");
  const box = $("shot-qr");
  const text = $("shot-qr-text");
  const use = $("shot-qr-use");
  if (!input || !box || !text || !use || !H.qrText || !H.screenshot) return;

  const LIB = "../../vendor/jsqr/jsQR.js"; // the checker pages live two folders deep, in the extension and on the website
  const MAX_SIDE = 1600; // large photos are scaled down first; QR codes stay readable and it is much faster

  let found = null; // { kind, text } of the code in the current picture, kept in this page's memory only
  let run = 0; // ignores a slow read of an earlier picture

  let loading = null;
  function loadLibrary() {
    if (typeof self.jsQR === "function") return Promise.resolve();
    if (!loading) {
      loading = new Promise((resolve, reject) => {
        const tag = document.createElement("script");
        tag.src = LIB;
        tag.onload = () => (typeof self.jsQR === "function" ? resolve() : reject(new Error("QR reader missing")));
        tag.onerror = () => reject(new Error("The bundled QR reader could not be loaded."));
        document.head.appendChild(tag);
      }).catch((e) => {
        loading = null;
        throw e;
      });
    }
    return loading;
  }

  function hide() {
    run += 1;
    found = null;
    box.hidden = true;
    use.hidden = true;
    text.textContent = "";
  }

  async function pixelsOf(file) {
    const bitmap = await createImageBitmap(file);
    try {
      const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
      const w = Math.max(1, Math.round(bitmap.width * scale));
      const h = Math.max(1, Math.round(bitmap.height * scale));
      const canvas = document.createElement("canvas");
      canvas.width = w;
      canvas.height = h;
      const g = canvas.getContext("2d", { willReadFrequently: true });
      g.drawImage(bitmap, 0, 0, w, h);
      const data = g.getImageData(0, 0, w, h);
      canvas.width = 0; // release the pixels
      canvas.height = 0;
      return data;
    } finally {
      bitmap.close();
    }
  }

  async function look(file) {
    const mine = run;
    // The same checks as the screenshot checker: size, then the real file type. A refused file is explained there.
    if (!H.screenshot.validateImage({ size: file.size }).ok) return;
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (!H.screenshot.validateImage({ size: file.size }, head).ok) return;
    await loadLibrary();
    const img = await pixelsOf(file);
    const code = self.jsQR(img.data, img.width, img.height, { inversionAttempts: "attemptBoth" });
    if (mine !== run || !code) return; // no QR code: say nothing, the screenshot check carries on as before
    const result = H.qrText.classify(code.data);
    if (result.kind === "empty") return;
    found = result;
    text.textContent = result.notice;
    use.textContent = result.button || "";
    use.hidden = !result.button;
    box.hidden = false;
  }

  input.addEventListener("change", () => {
    hide();
    const file = input.files && input.files[0];
    if (!file) return;
    look(file).catch(() => hide());
  });

  use.addEventListener("click", () => {
    if (!found) return;
    const target = found.kind === "upi" ? $("upi-qr") : $("link-input");
    const section = found.kind === "upi" ? $("upi-check") : $("link-check");
    const next = found.kind === "upi" ? $("upi-analyze") : $("link-form") && $("link-form").querySelector("button[type=submit]");
    if (!target || !section) return;
    target.value = found.text;
    target.dispatchEvent(new Event("input", { bubbles: true }));
    section.scrollIntoView();
    if (next) next.focus();
  });

  for (const id of ["shot-remove", "shot-clear"]) {
    const b = $(id);
    if (b) b.addEventListener("click", hide);
  }
})();

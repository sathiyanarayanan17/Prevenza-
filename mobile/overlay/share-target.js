/*
 * Prevenza for Android: "Share to Prevenza".
 * Another app (WhatsApp, Messages, Gallery) shares text or an image to Prevenza. The Android side keeps it in memory
 * until this page asks for it once; nothing is written to disk. The shared content is only PUT INTO the matching
 * checker's input. The user still presses the check button, and Prevenza never reads anything by itself.
 * This file is copied into the app by scripts/build-mobile.js. It is not part of the website.
 */
(function () {
  "use strict";
  const cap = self.Capacitor;
  if (!cap || typeof cap.nativePromise !== "function") return; // opened in a normal browser: nothing to do
  const $ = (id) => document.getElementById(id);
  const H = self.Prevenza;

  function say(text, kind) {
    if (H && H.ui && H.ui.toast) H.ui.toast(text, kind);
  }

  function goTo(sectionId, fieldId) {
    const section = $(sectionId);
    if (section) section.scrollIntoView();
    const field = $(fieldId);
    if (field) field.focus();
  }

  function looksLikeOneLink(text) {
    const t = text.trim();
    return t.length > 0 && t.length <= 2048 && !/\s/.test(t) && (/^https?:\/\//i.test(t) || /^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t));
  }

  function showText(text) {
    if (looksLikeOneLink(text)) {
      $("link-input").value = text.trim();
      goTo("link-check", "link-input");
      say("Link received. Press Check link.");
    } else {
      const box = $("msg-input");
      box.value = text.slice(0, Number(box.getAttribute("maxlength")) || 5000);
      box.dispatchEvent(new Event("input", { bubbles: true }));
      goTo("message-check", "msg-input");
      say("Message received. Press Analyze message.");
    }
  }

  function showImage(item) {
    const bin = atob(item.base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const file = new File([bytes], "shared-screenshot", { type: item.mime });
    const transfer = new DataTransfer();
    transfer.items.add(file);
    const input = $("shot-file");
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", { bubbles: true }));
    goTo("screenshot-check", "shot-analyze");
    say("Screenshot received. Press Read and check screenshot.");
  }

  async function take() {
    let item;
    try {
      item = await cap.nativePromise("ShareTarget", "getShared", {});
    } catch (e) {
      return;
    }
    if (!item || item.kind === "none") return;
    if (item.kind === "text" && typeof item.text === "string") showText(item.text);
    else if (item.kind === "image" && typeof item.base64 === "string" && /^image\/(png|jpeg)$/.test(item.mime)) showImage(item);
    else if (item.kind === "unsupported") say("Prevenza reads PNG and JPEG screenshots, or text.", "error");
    else if (item.kind === "too-large") say("That image is too large. Choose one under 8 MB.", "error");
  }

  take();
  // A share that arrives while the app is already open.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") take();
  });
  if (typeof cap.addListener === "function") cap.addListener("ShareTarget", "shareReceived", take);
})();

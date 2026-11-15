/*
 * Prevenza: background service worker.
 * Wires the message router to Chrome. All decisions live in handler.js; this file only connects the pieces.
 * Listeners are registered at the top level, as Manifest V3 requires.
 */
importScripts(
  "../shared/constants.js",
  "../shared/settings.js",
  "../shared/storage.js",
  "./handler.js"
);

const H = self.Prevenza;
const store = H.createStore(chrome.storage.local);

// Send a message to the content script in every open tab. Tabs without one simply do not answer.
async function broadcast(message) {
  let tabs = [];
  try {
    tabs = await chrome.tabs.query({});
  } catch (e) {
    return;
  }
  await Promise.allSettled(
    tabs.filter((t) => typeof t.id === "number").map((t) => chrome.tabs.sendMessage(t.id, message))
  );
}

const background = H.createBackground({
  store,
  runtimeId: chrome.runtime.id,
  version: chrome.runtime.getManifest().version,
  broadcast,
});

chrome.runtime.onInstalled.addListener(() => {
  store.init().catch(() => undefined);
});

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  background.handle(message, sender).then(
    (reply) => sendResponse(reply),
    () => sendResponse({ ok: false, error: "internal-error" })
  );
  return true; // the reply is sent asynchronously
});

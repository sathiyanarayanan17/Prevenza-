// Test helpers: an in-memory stand-in for chrome.storage.local.
function createFakeArea(initial) {
  const data = Object.assign({}, initial || {});
  const calls = { get: 0, set: 0, remove: 0 };
  return {
    data,
    calls,
    async get(keys) {
      calls.get += 1;
      await Promise.resolve(); // behave asynchronously like the real thing
      const list = Array.isArray(keys) ? keys : [keys];
      const out = {};
      for (const k of list) if (k in data) out[k] = JSON.parse(JSON.stringify(data[k]));
      return out;
    },
    async set(obj) {
      calls.set += 1;
      await Promise.resolve();
      for (const [k, v] of Object.entries(obj)) data[k] = JSON.parse(JSON.stringify(v));
    },
    async remove(keys) {
      calls.remove += 1;
      await Promise.resolve();
      for (const k of Array.isArray(keys) ? keys : [keys]) delete data[k];
    },
  };
}

module.exports = { createFakeArea };

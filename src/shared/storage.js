/*
 * Prevenza: storage layer. Uses chrome.storage.local only, so nothing is synced to any account.
 * createStore(area) takes any object with get/set/remove, which lets the unit tests use an in-memory fake.
 * Writes are queued so two quick updates can never overwrite each other.
 */
(function (root, factory) {
  const isNode = typeof module === "object" && module.exports;
  const deps = isNode ? Object.assign({}, require("./constants.js"), require("./settings.js")) : root.Prevenza;
  const api = factory(deps);
  if (isNode) {
    module.exports = api;
  } else {
    root.Prevenza = root.Prevenza || {};
    Object.assign(root.Prevenza, api);
  }
})(typeof self !== "undefined" ? self : this, function (H) {
  const K = H.STORAGE_KEYS;

  function createStore(area, now) {
    const clock = now || (() => new Date().toISOString());
    let chain = Promise.resolve();

    // Run storage changes one at a time, in order.
    function enqueue(task) {
      const run = chain.then(task, task);
      chain = run.then(() => undefined, () => undefined);
      return run;
    }

    async function read(key) {
      const result = await area.get(key);
      return result ? result[key] : undefined;
    }

    async function getSettings() {
      return H.sanitizeSettings(await read(K.settings));
    }

    async function getStats() {
      return H.sanitizeStats(await read(K.stats));
    }

    /** Merge a partial update into the saved settings. Unknown or invalid values are dropped. */
    function saveSettings(partial) {
      return enqueue(async () => {
        const current = await getSettings();
        const patch = H.isPlainObject(partial) ? partial : {};
        const next = H.sanitizeSettings(Object.assign({}, current, patch));
        await area.set({ [K.settings]: next });
        return next;
      });
    }

    /** Count one protected page. Stores only a number and a timestamp. */
    function recordPageSeen() {
      return enqueue(async () => {
        const stats = await getStats();
        stats.pagesSeen += 1;
        stats.lastActiveAt = clock();
        const next = H.sanitizeStats(stats);
        await area.set({ [K.stats]: next });
        return next;
      });
    }

    /** First run: write defaults if nothing is stored yet. */
    function init() {
      return enqueue(async () => {
        const settings = H.sanitizeSettings(await read(K.settings));
        const stats = H.sanitizeStats(await read(K.stats));
        if (!stats.installedAt) stats.installedAt = clock();
        await area.set({ [K.settings]: settings, [K.stats]: H.sanitizeStats(stats), [K.schema]: H.SCHEMA_VERSION });
        return { settings, stats };
      });
    }

    function resetStats() {
      return enqueue(async () => {
        const old = await getStats();
        const next = H.sanitizeStats({ installedAt: old.installedAt || clock() });
        await area.set({ [K.stats]: next });
        return next;
      });
    }

    function resetSettings() {
      return enqueue(async () => {
        const next = H.sanitizeSettings({});
        await area.set({ [K.settings]: next });
        return next;
      });
    }

    /** Write, read back and delete a marker value. Used by the dashboard "system check". */
    function selfTest() {
      return enqueue(async () => {
        const token = String(Math.random()).slice(2);
        await area.set({ [K.selfTest]: token });
        const back = await read(K.selfTest);
        await area.remove(K.selfTest);
        return back === token;
      });
    }

    return { getSettings, getStats, saveSettings, recordPageSeen, init, resetStats, resetSettings, selfTest };
  }

  return { createStore };
});

// In-memory stand-in for browser.storage.local (get/set with structured clones).
export function memoryStorage(initial = {}) {
  const data = structuredClone(initial);
  return {
    data,
    async get(keys) {
      const list = keys == null ? Object.keys(data) : [keys].flat();
      return Object.fromEntries(list.filter((k) => k in data).map((k) => [k, structuredClone(data[k])]));
    },
    async set(obj) {
      Object.assign(data, structuredClone(obj));
    },
  };
}

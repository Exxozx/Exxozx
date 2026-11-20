// Browser implementation of src/storage.js: saves to this browser's localStorage.
// Falls back to memory (data lasts until the tab closes) if storage is blocked.
const DB_KEY = 'muratab.v1.db';
const KEYS_KEY = 'muratab.v1.keys';
const memory = {};

function read(key) {
  try {
    const v = localStorage.getItem(key);
    return v == null ? null : JSON.parse(v);
  } catch {
    return memory[key] ?? null;
  }
}

function write(key, value) {
  memory[key] = value;
  try {
    localStorage.setItem(key, JSON.stringify(value));
    browserStorage.persistent = true;
  } catch {
    browserStorage.persistent = false;
  }
}

export const browserStorage = { persistent: true };

export function defaultStorage() {
  return {
    load() {
      const db = read(DB_KEY);
      const keys = read(KEYS_KEY);
      return db && keys ? { db, keys } : null;
    },
    saveDb: (db) => write(DB_KEY, db),
    saveKeys: (keys) => write(KEYS_KEY, keys),
  };
}

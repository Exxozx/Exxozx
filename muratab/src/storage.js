'use strict';
/**
 * Persistence, Node.js implementation: JSON files in a data directory.
 * The browser build swaps this file for web/storage-browser.js (same interface).
 *
 * Interface: { load() -> { db, keys } | null, saveDb(db), saveKeys(keys) }
 * Private keys are kept apart from the shared data. In production each branch
 * would hold only its own key (e.g. in an HSM / KMS) and HQ's key stays at HQ.
 */
const fs = require('fs');
const path = require('path');

function fileStorage(dataDir) {
  const dbFile = path.join(dataDir, 'db.json');
  const keyFile = path.join(dataDir, 'keys.json');
  const write = (file, data) => {
    fs.mkdirSync(dataDir, { recursive: true });
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
    fs.renameSync(tmp, file);
  };
  return {
    load() {
      if (!fs.existsSync(dbFile) || !fs.existsSync(keyFile)) return null;
      return { db: JSON.parse(fs.readFileSync(dbFile, 'utf8')), keys: JSON.parse(fs.readFileSync(keyFile, 'utf8')) };
    },
    saveDb: (db) => write(dbFile, db),
    saveKeys: (keys) => write(keyFile, keys),
  };
}

module.exports = { defaultStorage: fileStorage };

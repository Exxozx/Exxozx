'use strict';
/**
 * Crypto primitives used by the ledger, Node.js implementation (built-in `crypto`).
 * The browser build swaps this file for web/crypto-browser.js (same exports).
 */
const crypto = require('crypto');

const sha256Hex = (s) => crypto.createHash('sha256').update(s).digest('hex');
const randomHex = (bytes) => crypto.randomBytes(bytes).toString('hex');

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

const sign = (data, privateKey) => crypto.sign(null, Buffer.from(data), privateKey).toString('base64');

function verify(data, signature, publicKey) {
  try {
    return crypto.verify(null, Buffer.from(data), publicKey, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

module.exports = { sha256Hex, randomHex, generateKeyPair, sign, verify };

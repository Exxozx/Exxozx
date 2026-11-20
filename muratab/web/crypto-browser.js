// Browser implementation of src/crypto.js: Ed25519 signatures and SHA-256 via the
// audited @noble libraries (synchronous, so the shared ledger code runs unchanged).
import * as ed from '@noble/ed25519';
import { sha256 } from '@noble/hashes/sha256';
import { sha512 } from '@noble/hashes/sha512';
import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/hashes/utils';

ed.etc.sha512Sync = (...m) => sha512(ed.etc.concatBytes(...m));

const toB64 = (bytes) => btoa(String.fromCharCode(...bytes));
const fromB64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

export const sha256Hex = (s) => bytesToHex(sha256(utf8ToBytes(s)));
export const randomHex = (n) => bytesToHex(crypto.getRandomValues(new Uint8Array(n)));

export function generateKeyPair() {
  const priv = ed.utils.randomPrivateKey();
  return { publicKey: bytesToHex(ed.getPublicKey(priv)), privateKey: bytesToHex(priv) };
}

export const sign = (data, privateKey) => toB64(ed.sign(utf8ToBytes(data), hexToBytes(privateKey)));

export function verify(data, signature, publicKey) {
  try {
    return ed.verify(fromB64(signature), utf8ToBytes(data), hexToBytes(publicKey));
  } catch {
    return false;
  }
}

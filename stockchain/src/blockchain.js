'use strict';
/**
 * Permissioned, proof-of-authority ledger shared by every branch in the chain.
 *
 * - The genesis block is signed by HQ and registers each branch's Ed25519 public key.
 * - Every subsequent block carries exactly one transaction and is signed by the
 *   branch that authored it. Only the party entitled to an action may sign it
 *   (e.g. only the sending branch can dispatch, only the receiving branch can
 *   confirm receipt).
 * - Blocks are hash-linked (SHA-256 over a canonical serialisation), so editing
 *   any historical block breaks the chain and its signature.
 * - Transfer state is never stored separately: it is derived by replaying the
 *   chain, so the ledger is the single source of truth for inter-branch stock movement.
 */
const crypto = require('crypto');

const HQ = 'HQ';
const ZERO_HASH = '0'.repeat(64);

function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .filter((k) => value[k] !== undefined)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonical(value[k])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function generateKeyPair() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync('ed25519');
  return {
    publicKey: publicKey.export({ type: 'spki', format: 'pem' }),
    privateKey: privateKey.export({ type: 'pkcs8', format: 'pem' }),
  };
}

function sign(data, privateKeyPem) {
  return crypto.sign(null, Buffer.from(data), privateKeyPem).toString('base64');
}

function verifySignature(data, signature, publicKeyPem) {
  try {
    return crypto.verify(null, Buffer.from(data), publicKeyPem, Buffer.from(signature, 'base64'));
  } catch {
    return false;
  }
}

function blockHash(block) {
  const { index, timestamp, prevHash, validator, tx } = block;
  return sha256(canonical({ index, timestamp, prevHash, validator, tx }));
}

function emptyState() {
  return { members: new Map(), transfers: new Map() };
}

function validLines(lines) {
  return (
    Array.isArray(lines) &&
    lines.length > 0 &&
    lines.every((l) => l && typeof l.ingredientId === 'string' && typeof l.qty === 'number' && l.qty > 0)
  );
}

/**
 * Validate a block against the previous block and current state and, if valid,
 * apply its transaction to `state`. Returns a list of error strings (empty = ok).
 */
function applyBlock(state, block, prev, hqPublicKey) {
  const errors = [];
  const at = `block #${block.index}`;
  const expectedIndex = prev ? prev.index + 1 : 0;
  if (block.index !== expectedIndex) errors.push(`${at}: index should be ${expectedIndex}`);
  if (block.prevHash !== (prev ? prev.hash : ZERO_HASH)) errors.push(`${at}: prevHash does not link to previous block`);
  if (blockHash(block) !== block.hash) errors.push(`${at}: hash mismatch (contents were altered)`);

  const signerKey = block.validator === HQ ? hqPublicKey : state.members.get(block.validator)?.publicKey;
  if (!signerKey) errors.push(`${at}: validator "${block.validator}" is not a registered member`);
  else if (!verifySignature(block.hash, block.signature, signerKey)) errors.push(`${at}: invalid signature by ${block.validator}`);
  if (errors.length) return errors;

  const { type, payload = {} } = block.tx || {};
  const fail = (msg) => errors.push(`${at} (${type}): ${msg}`);
  const record = (t) =>
    t.history.push({ type, by: block.validator, at: block.timestamp, block: block.index, hash: block.hash });
  const t = payload.transferId ? state.transfers.get(payload.transferId) : undefined;

  switch (type) {
    case 'GENESIS':
    case 'MEMBER_ADD': {
      if (block.validator !== HQ) return fail('only HQ may register members'), errors;
      if (type === 'GENESIS' && block.index !== 0) return fail('genesis must be block 0'), errors;
      for (const m of payload.members || []) {
        if (!m.branchId || !m.publicKey) return fail('member requires branchId and publicKey'), errors;
        state.members.set(m.branchId, { branchId: m.branchId, name: m.name, publicKey: m.publicKey });
      }
      return errors;
    }
    case 'TRANSFER_REQUEST': {
      if (!payload.transferId || t) return fail('transferId missing or already used'), errors;
      if (block.validator !== payload.toBranchId) return fail('only the requesting (receiving) branch may sign a request'), errors;
      if (!state.members.has(payload.fromBranchId) || payload.fromBranchId === payload.toBranchId)
        return fail('invalid counterparty branch'), errors;
      if (!validLines(payload.lines)) return fail('invalid lines'), errors;
      const nt = {
        id: payload.transferId,
        fromBranchId: payload.fromBranchId,
        toBranchId: payload.toBranchId,
        lines: payload.lines,
        note: payload.note || '',
        status: 'requested',
        requestedAt: block.timestamp,
        history: [],
      };
      record(nt);
      state.transfers.set(nt.id, nt);
      return errors;
    }
    case 'TRANSFER_DISPATCH': {
      if (!payload.transferId) return fail('transferId missing'), errors;
      if (block.validator !== payload.fromBranchId) return fail('only the sending branch may dispatch'), errors;
      if (!state.members.has(payload.toBranchId) || payload.fromBranchId === payload.toBranchId)
        return fail('invalid destination branch'), errors;
      if (!validLines(payload.lines)) return fail('invalid lines'), errors;
      let tr = t;
      if (tr) {
        if (tr.status !== 'requested') return fail(`cannot dispatch a transfer that is ${tr.status}`), errors;
        if (tr.fromBranchId !== payload.fromBranchId || tr.toBranchId !== payload.toBranchId)
          return fail('branches do not match the original request'), errors;
      } else {
        tr = {
          id: payload.transferId,
          fromBranchId: payload.fromBranchId,
          toBranchId: payload.toBranchId,
          note: payload.note || '',
          history: [],
        };
        state.transfers.set(tr.id, tr);
      }
      tr.lines = payload.lines;
      tr.status = 'in_transit';
      tr.dispatchedAt = block.timestamp;
      record(tr);
      return errors;
    }
    case 'TRANSFER_RECEIVE': {
      if (!t) return fail('unknown transfer'), errors;
      if (t.status !== 'in_transit') return fail(`cannot receive a transfer that is ${t.status}`), errors;
      if (block.validator !== t.toBranchId) return fail('only the receiving branch may confirm receipt'), errors;
      if (!Array.isArray(payload.lines)) return fail('invalid lines'), errors;
      t.receivedLines = payload.lines;
      t.status = 'received';
      t.receivedAt = block.timestamp;
      record(t);
      return errors;
    }
    case 'TRANSFER_REJECT': {
      if (!t) return fail('unknown transfer'), errors;
      if (t.status !== 'requested') return fail(`cannot reject a transfer that is ${t.status}`), errors;
      if (block.validator !== t.fromBranchId) return fail('only the asked branch may reject'), errors;
      t.status = 'rejected';
      t.reason = payload.reason || '';
      record(t);
      return errors;
    }
    case 'TRANSFER_CANCEL': {
      if (!t) return fail('unknown transfer'), errors;
      if (t.status !== 'requested') return fail(`cannot cancel a transfer that is ${t.status}`), errors;
      if (block.validator !== t.toBranchId) return fail('only the requesting branch may cancel'), errors;
      t.status = 'cancelled';
      record(t);
      return errors;
    }
    default:
      return fail('unknown transaction type'), errors;
  }
}

function replay(chain, hqPublicKey) {
  const state = emptyState();
  const errors = [];
  let prev = null;
  for (const block of chain) {
    const errs = applyBlock(state, block, prev, hqPublicKey);
    if (errs.length) {
      errors.push(...errs);
      break; // everything after an invalid block is untrusted
    }
    prev = block;
  }
  return { state, errors };
}

class Ledger {
  constructor(chain, hqPublicKey) {
    this.chain = chain;
    this.hqPublicKey = hqPublicKey;
    const { state, errors } = replay(chain, hqPublicKey);
    this.state = state;
    this.loadErrors = errors;
  }

  static create({ hqKeys, members, timestamp }) {
    const chain = [];
    const ledger = new Ledger(chain, hqKeys.publicKey);
    ledger.append({ type: 'GENESIS', payload: { members } }, HQ, hqKeys.privateKey, timestamp);
    return ledger;
  }

  get head() {
    return this.chain[this.chain.length - 1] || null;
  }

  /** Build, sign, validate and append a block. Throws if the transaction is not allowed. */
  append(tx, validator, privateKey, timestamp = new Date().toISOString()) {
    const prev = this.head;
    const block = {
      index: prev ? prev.index + 1 : 0,
      timestamp,
      prevHash: prev ? prev.hash : ZERO_HASH,
      validator,
      tx,
    };
    block.hash = blockHash(block);
    block.signature = sign(block.hash, privateKey);
    const trial = structuredClone(this.state);
    const errors = applyBlock(trial, block, prev, this.hqPublicKey);
    if (errors.length) {
      const err = new Error(errors.join('; '));
      err.status = 400;
      throw err;
    }
    this.state = trial;
    this.chain.push(block);
    return block;
  }

  verify() {
    const { errors } = replay(this.chain, this.hqPublicKey);
    return { valid: errors.length === 0, blocks: this.chain.length, headHash: this.head?.hash || null, errors };
  }

  transfers() {
    return [...this.state.transfers.values()];
  }

  getTransfer(id) {
    return this.state.transfers.get(id);
  }
}

module.exports = { Ledger, HQ, canonical, sha256, blockHash, generateKeyPair, sign, verifySignature, replay };

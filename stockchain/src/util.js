'use strict';
const crypto = require('crypto');

class HttpError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

const DAY_MS = 24 * 60 * 60 * 1000;

function round(n, decimals = 3) {
  const f = 10 ** decimals;
  return Math.round((n + Number.EPSILON) * f) / f;
}

function uid(prefix) {
  return `${prefix}-${crypto.randomBytes(4).toString('hex')}`;
}

function assert(cond, status, message, details) {
  if (!cond) throw new HttpError(status, message, details);
}

module.exports = { HttpError, DAY_MS, round, uid, assert };

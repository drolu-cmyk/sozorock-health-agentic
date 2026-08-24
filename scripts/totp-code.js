#!/usr/bin/env node

const crypto = require('node:crypto');

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

function decodeBase32(input) {
  const normalized = String(input || '').toUpperCase().replace(/=+$/g, '').replace(/\s+/g, '');
  if (!normalized || /[^A-Z2-7]/.test(normalized)) throw new Error('base32 secret is invalid');
  let bits = '';
  for (const char of normalized) {
    bits += ALPHABET.indexOf(char).toString(2).padStart(5, '0');
  }
  const bytes = [];
  for (let offset = 0; offset + 8 <= bits.length; offset += 8) {
    bytes.push(Number.parseInt(bits.slice(offset, offset + 8), 2));
  }
  return Buffer.from(bytes);
}

function totp(secret, options = {}) {
  const timestampMs = options.timestampMs ?? Date.now();
  const stepSeconds = options.stepSeconds ?? 30;
  const digits = options.digits ?? 6;
  if (!Number.isFinite(timestampMs) || timestampMs < 0) throw new Error('timestamp is invalid');
  if (!Number.isInteger(stepSeconds) || stepSeconds < 1) throw new Error('stepSeconds is invalid');
  if (!Number.isInteger(digits) || digits < 6 || digits > 8) throw new Error('digits is invalid');
  const counter = BigInt(Math.floor(timestampMs / 1000 / stepSeconds));
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(counter);
  const digest = crypto.createHmac('sha1', decodeBase32(secret)).update(message).digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const value = (digest.readUInt32BE(offset) & 0x7fffffff) % (10 ** digits);
  return String(value).padStart(digits, '0');
}

if (require.main === module) {
  try {
    const secret = process.argv[2];
    process.stdout.write(`${totp(secret)}\n`);
  } catch (error) {
    console.error(error?.message || 'TOTP generation failed.');
    process.exitCode = 1;
  }
}

module.exports = { decodeBase32, totp };

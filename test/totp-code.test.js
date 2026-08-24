const test = require('node:test');
const assert = require('node:assert/strict');
const { decodeBase32, totp } = require('../scripts/totp-code');

test('TOTP generator matches RFC 6238 SHA1 vector at 59 seconds', () => {
  const secret = 'GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ';
  assert.equal(totp(secret, { timestampMs: 59000, digits: 8 }), '94287082');
  assert.equal(totp(secret, { timestampMs: 59000, digits: 6 }), '287082');
});

test('base32 decoder rejects malformed secrets', () => {
  assert.throws(() => decodeBase32(''), /invalid/);
  assert.throws(() => decodeBase32('NOT-BASE32!'), /invalid/);
});

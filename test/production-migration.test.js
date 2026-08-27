const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { migrationFiles, quoteIdentifier } = require('../scripts/migrate-postgres');

test('production migration discovery admits only numbered immutable SQL migrations in lexical order', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'cbcap-migrations-'));
  try {
    fs.writeFileSync(path.join(root, '002_second.sql'), 'SELECT 2;');
    fs.writeFileSync(path.join(root, '001_first.sql'), 'SELECT 1;');
    fs.writeFileSync(path.join(root, 'README.md'), 'ignore');
    fs.writeFileSync(path.join(root, 'bad.sql'), 'ignore');
    assert.deepEqual(migrationFiles(root).map((item) => item.name), ['001_first.sql', '002_second.sql']);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('database identifier quoting escapes embedded double quotes', () => {
  assert.equal(quoteIdentifier('cbcap'), '"cbcap"');
  assert.equal(quoteIdentifier('a"b'), '"a""b"');
});

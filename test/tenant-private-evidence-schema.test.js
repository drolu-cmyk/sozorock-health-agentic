const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');

const migrationUrl = new URL('../infrastructure/postgres/005_tenant_private_evidence.sql', import.meta.url);

test('tenant-private evidence tables force tenant row-level security', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  for (const table of ['cbcap_tenant_evidence_documents', 'cbcap_tenant_evidence_reviews']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`, 'i'));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`, 'i'));
  }
  assert.match(sql, /current_setting\('app\.tenant_id', true\)/i);
});

test('private evidence review has same-tenant referential integrity and append-only history', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /FOREIGN KEY \(tenant_id, document_id\)[\s\S]*REFERENCES cbcap_tenant_evidence_documents \(tenant_id, id\)/i);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON cbcap_tenant_evidence_documents/i);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON cbcap_tenant_evidence_reviews/i);
  assert.match(sql, /tenant-private evidence history is append-only/i);
});

test('eligible private evidence is structurally barred from PHI, person-level records, secrets, public storage, or incomplete security scan', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.match(sql, /aggregation_level <> 'person_level'/i);
  assert.match(sql, /NOT contains_phi/i);
  assert.match(sql, /NOT contains_individual_health_records/i);
  assert.match(sql, /NOT contains_credentials_or_secrets/i);
  assert.match(sql, /security_scan_status = 'clean'/i);
  assert.match(sql, /public_access_blocked boolean NOT NULL CHECK \(public_access_blocked\)/i);
  assert.match(sql, /encryption_mode text NOT NULL CHECK \(encryption_mode = 'aws:kms'\)/i);
});

test('migration stores metadata and governance state, not raw document content or public evidence fields', async () => {
  const sql = await readFile(migrationUrl, 'utf8');
  assert.doesNotMatch(sql, /\braw_content\b/i);
  assert.doesNotMatch(sql, /\bdocument_text\b/i);
  assert.doesNotMatch(sql, /\bembedding\b/i);
  assert.doesNotMatch(sql, /\bpublic_evidence\b/i);
  assert.match(sql, /does not publish evidence or promote institutional truth/i);
});

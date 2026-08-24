const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const sql = readFileSync(join(__dirname, '..', 'infrastructure', 'postgres', '004_monitoring_findings.sql'), 'utf8');

test('monitoring findings force tenant row-level security', () => {
  assert.match(sql, /ALTER TABLE cbcap_monitor_findings ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE cbcap_monitor_findings FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /CREATE POLICY cbcap_monitor_findings_tenant_scope ON cbcap_monitor_findings/);
  assert.match(sql, /current_setting\('app\.tenant_id', true\)/);
});

test('monitoring findings are append-only and deduplicated per tenant condition', () => {
  assert.match(sql, /UNIQUE \(tenant_id, finding_key\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON cbcap_monitor_findings/);
  assert.match(sql, /CB-CAP monitoring findings are append-only/);
});

test('database stores only actionable or blocked statuses', () => {
  assert.match(sql, /status text NOT NULL CHECK \(status IN \('change_detected','attention_required','blocked'\)\)/);
  assert.doesNotMatch(sql, /status IN \([^\n]*'no_change'/);
});

test('monitoring finding schema stores references and fingerprints rather than raw source content', () => {
  assert.match(sql, /source_entity_ids jsonb/);
  assert.match(sql, /baseline_fingerprint text/);
  assert.match(sql, /current_fingerprint text/);
  assert.doesNotMatch(sql, /^\s*(?:raw_content|document_text|transcript|source_content)\s+(?:text|jsonb|varchar)/im);
});

const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');

const sql = readFileSync(path.join(__dirname, '../infrastructure/postgres/002_workspace_institutional_memory.sql'), 'utf8');

test('workspace and institutional memory tables force tenant row-level security', () => {
  for (const table of ['cbcap_workspace_items', 'cbcap_workspace_events', 'cbcap_institutional_memory']) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY`));
  }
  assert.match(sql, /current_setting\('app\.tenant_id', true\)/);
});

test('workspace change history and institutional memory are append-only', () => {
  assert.match(sql, /cbcap_workspace_events is append-only/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON cbcap_workspace_events/);
  assert.match(sql, /cbcap_institutional_memory is append-only/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON cbcap_institutional_memory/);
});

test('institutional memory requires evidence, reasons, and valid review provenance', () => {
  assert.match(sql, /jsonb_array_length\(evidence_entity_ids\) > 0/);
  assert.match(sql, /jsonb_array_length\(reason_codes\) > 0/);
  assert.match(sql, /cbcap_memory_review_fields/);
  assert.match(sql, /reviewed_by IS NOT NULL/);
  assert.match(sql, /reviewed_at IS NOT NULL/);
});

test('database prevents duplicate review and duplicate supersession transitions', () => {
  assert.match(sql, /cbcap_institutional_memory_single_review_idx/);
  assert.match(sql, /source_proposal_id IS NOT NULL/);
  assert.match(sql, /cbcap_institutional_memory_single_supersession_idx/);
  assert.match(sql, /supersedes_memory_id IS NOT NULL/);
});

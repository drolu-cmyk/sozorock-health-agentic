const test = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');

const sql = readFileSync(join(__dirname, '..', 'infrastructure', 'postgres', '003_learning_evaluation_memory.sql'), 'utf8');

const TABLES = [
  'cbcap_learning_trajectory',
  'cbcap_learning_evaluations',
  'cbcap_learning_corrections',
  'cbcap_learning_candidates',
  'cbcap_learning_candidate_reviews',
];

test('learning and evaluation tables force tenant row-level security', () => {
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`ALTER TABLE ${table} ENABLE ROW LEVEL SECURITY;`));
    assert.match(sql, new RegExp(`ALTER TABLE ${table} FORCE ROW LEVEL SECURITY;`));
    assert.match(sql, new RegExp(`CREATE POLICY ${table}_tenant_scope ON ${table}`));
  }
});

test('all learning domains are append-only and candidates cannot auto-apply', () => {
  for (const table of TABLES) {
    assert.match(sql, new RegExp(`BEFORE UPDATE OR DELETE ON ${table}`));
  }
  assert.match(sql, /automatic_application_allowed boolean NOT NULL DEFAULT false CHECK \(automatic_application_allowed=false\)/);
  assert.match(sql, /application_state text NOT NULL DEFAULT 'not_applied' CHECK \(application_state='not_applied'\)/);
  assert.doesNotMatch(sql, /UPDATE cbcap_learning_/);
  assert.doesNotMatch(sql, /DELETE FROM cbcap_learning_/);
});

test('learning records preserve same-tenant parent integrity and one review per candidate', () => {
  assert.match(sql, /FOREIGN KEY \(tenant_id, trajectory_event_id\)[\s\S]*REFERENCES cbcap_learning_trajectory \(tenant_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(tenant_id, candidate_id\)[\s\S]*REFERENCES cbcap_learning_candidates \(tenant_id, id\)/);
  assert.match(sql, /UNIQUE \(tenant_id, candidate_id\)/);
});

test('candidate provenance is validated in PostgreSQL, not only in application code', () => {
  assert.match(sql, /CREATE OR REPLACE FUNCTION validate_cbcap_learning_candidate_refs\(\)/);
  assert.match(sql, /evaluation\.tenant_id = NEW\.tenant_id/);
  assert.match(sql, /evaluation\.id::text = ref\.value/);
  assert.match(sql, /correction\.tenant_id = NEW\.tenant_id/);
  assert.match(sql, /correction\.id::text = ref\.value/);
  assert.match(sql, /BEFORE INSERT ON cbcap_learning_candidates/);
  assert.match(sql, /learning candidate references an unknown or cross-tenant evaluation/);
  assert.match(sql, /learning candidate references an unknown or cross-tenant correction/);
});

test('trajectory schema excludes raw content columns and constrains deterministic model accounting', () => {
  assert.doesNotMatch(sql, /raw_content/i);
  assert.doesNotMatch(sql, /transcript/i);
  assert.match(sql, /actor_type <> 'deterministic'/);
  assert.match(sql, /model_provider IS NULL AND model_name IS NULL/);
});

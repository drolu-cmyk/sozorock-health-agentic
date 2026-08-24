const test = require('node:test');
const assert = require('node:assert/strict');
const { readFile } = require('node:fs/promises');
const path = require('node:path');

const migrationPath = path.join(__dirname, '../infrastructure/postgres/001_agent_run_memory.sql');

test('agent run schema forces tenant RLS and preserves append-only events', async () => {
  const sql = await readFile(migrationPath, 'utf8');
  assert.match(sql, /ALTER TABLE agent_runs ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE agent_runs FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE agent_run_events ENABLE ROW LEVEL SECURITY;/);
  assert.match(sql, /ALTER TABLE agent_run_events FORCE ROW LEVEL SECURITY;/);
  assert.match(sql, /current_setting\('app\.tenant_id', true\)/);
  assert.match(sql, /BEFORE UPDATE OR DELETE ON agent_run_events/);
  assert.match(sql, /agent_run_events is append-only/);
  assert.match(sql, /must not own this table or hold BYPASSRLS/);
});

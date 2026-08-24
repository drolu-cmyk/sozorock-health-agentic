const test = require('node:test');
const assert = require('node:assert/strict');
const { SqlWorkspaceMemory } = require('../packages/runtime/sql-workspace-memory');

const actor = { principalId: 'planner-1' };

test('SQL workspace create carries tenant scope and atomically appends event', async () => {
  const calls = [];
  const memory = new SqlWorkspaceMemory({
    tenantId: 'tenant-a',
    clock: () => '2026-08-23T23:30:00.000Z',
    query: async (sql, params) => {
      calls.push({ sql, params });
      return { rows: [{
        id: params[0], tenant_id: params[1], workspace_id: params[2], geography_id: params[3], item_type: params[4], title: params[5],
        content: JSON.parse(params[6]), status: params[7], version: 1, created_by: params[8], created_at: params[9], updated_by: params[8], updated_at: params[9],
      }] };
    },
  });
  const item = await memory.create({ workspaceId: 'w1', itemType: 'saved_view', content: { measure: 'm1' } }, actor);
  assert.equal(item.tenantId, 'tenant-a');
  assert.equal(item.version, 1);
  assert.match(calls[0].sql, /WITH inserted AS/);
  assert.match(calls[0].sql, /workspace_item_created/);
  assert.equal(calls[0].params[1], 'tenant-a');
});

test('SQL workspace update uses expected version and returns conflict when no row changes', async () => {
  const memory = new SqlWorkspaceMemory({ tenantId: 'tenant-a', query: async () => ({ rows: [] }) });
  await assert.rejects(
    () => memory.update('w1', '11111111-1111-4111-8111-111111111111', { status: 'done' }, 2, actor),
    (error) => error.code === 'VERSION_CONFLICT',
  );
});

test('SQL workspace list is tenant and workspace scoped', async () => {
  let seen;
  const memory = new SqlWorkspaceMemory({ tenantId: 'tenant-a', query: async (sql, params) => { seen = { sql, params }; return { rows: [] }; } });
  await memory.list('w1', { status: 'active' });
  assert.match(seen.sql, /tenant_id=\$1 AND workspace_id=\$2/);
  assert.deepEqual(seen.params, ['tenant-a','w1','active']);
});

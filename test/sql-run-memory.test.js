const test = require('node:test');
const assert = require('node:assert/strict');
const { SqlRunMemory } = require('../packages/runtime/sql-run-memory');

function fakeDatabase() {
  const runs = new Map();
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params: structuredClone(params) });
      const normalized = sql.replace(/\s+/g, ' ').trim();
      if (normalized.includes('WITH inserted AS')) {
        const [runId, tenantId, , , , createdAt, rawEvent] = params;
        if (runs.has(`${tenantId}:${runId}`)) {
          const error = new Error('duplicate');
          error.code = '23505';
          throw error;
        }
        runs.set(`${tenantId}:${runId}`, [{
          sequence: 1,
          event: JSON.parse(rawEvent),
          created_at: createdAt,
        }]);
        return { rows: [{ run_id: runId }] };
      }
      if (normalized.includes('WITH allocated AS')) {
        const [runId, tenantId, createdAt, , rawEvent] = params;
        const events = runs.get(`${tenantId}:${runId}`);
        if (!events) return { rows: [] };
        const row = {
          sequence: events.length + 1,
          event: JSON.parse(rawEvent),
          created_at: createdAt,
        };
        events.push(row);
        return { rows: [structuredClone(row)] };
      }
      if (normalized.includes("e.event_type = 'state_checkpoint'")) {
        const [runId, tenantId] = params;
        const events = runs.get(`${tenantId}:${runId}`) || [];
        const row = [...events].reverse().find((event) => event.event.type === 'state_checkpoint');
        return { rows: row ? [structuredClone(row)] : [] };
      }
      if (normalized.includes('ORDER BY e.sequence ASC')) {
        const [runId, tenantId] = params;
        return { rows: structuredClone(runs.get(`${tenantId}:${runId}`) || []) };
      }
      throw new Error(`Unexpected SQL in fake database: ${normalized}`);
    },
  };
}

test('SQL run memory keeps tenant ID on every database operation and preserves sequence', async () => {
  let tick = 0;
  const database = fakeDatabase();
  const memory = new SqlRunMemory({
    tenantId: 'county-team-1',
    query: database.query,
    clock: () => `2026-08-24T00:00:0${++tick}.000Z`,
  });

  await memory.createRun({ product: 'cbcap', taskType: 'county_plan' }, '11111111-1111-4111-8111-111111111111');
  await memory.append('11111111-1111-4111-8111-111111111111', { type: 'decision', value: { approved: false } });
  await memory.checkpoint('11111111-1111-4111-8111-111111111111', { runId: '11111111-1111-4111-8111-111111111111', status: 'awaiting_human_review' }, {
    nodeId: 'await_review',
    step: 6,
    status: 'awaiting_human_review',
    resumeAt: 'publish',
  });

  const events = await memory.read('11111111-1111-4111-8111-111111111111');
  assert.deepEqual(events.map((event) => event.sequence), [1, 2, 3]);
  assert.deepEqual(events.map((event) => event.type), ['run_created', 'decision', 'state_checkpoint']);
  const checkpoint = await memory.latestCheckpoint('11111111-1111-4111-8111-111111111111');
  assert.equal(checkpoint.resumeAt, 'publish');
  assert.equal(checkpoint.state.status, 'awaiting_human_review');
  assert.ok(database.calls.every((call) => call.params[1] === 'county-team-1'));
});

test('SQL run memory cannot read a run through a different tenant adapter', async () => {
  const database = fakeDatabase();
  const owner = new SqlRunMemory({ tenantId: 'tenant-a', query: database.query });
  const other = new SqlRunMemory({ tenantId: 'tenant-b', query: database.query });
  const runId = '22222222-2222-4222-8222-222222222222';
  await owner.createRun({ product: 'cbcap', taskType: 'county_plan' }, runId);
  assert.equal((await owner.read(runId)).length, 1);
  assert.equal((await other.read(runId)).length, 0);
  assert.equal(await other.latestCheckpoint(runId), null);
});

test('SQL run memory rejects unsafe identifiers and missing tenant scope', () => {
  const query = async () => ({ rows: [] });
  assert.throws(() => new SqlRunMemory({ query }), /tenantId is required/);
  assert.throws(
    () => new SqlRunMemory({ query, tenantId: 'tenant-a', eventsTable: 'agent_run_events; DROP TABLE users' }),
    /safe lowercase SQL identifier/,
  );
});

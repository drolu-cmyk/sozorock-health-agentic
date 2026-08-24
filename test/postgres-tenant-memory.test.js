const test = require('node:test');
const assert = require('node:assert/strict');
const {
  createPostgresLearningMemoryFactory,
  createPostgresRunMemoryFactory,
  createPostgresTenantQuery,
} = require('../server/postgres-tenant-memory');

function fakePool(options = {}) {
  const calls = [];
  let released = 0;
  const client = {
    async query(sql, params) {
      calls.push({ sql, params: structuredClone(params || []) });
      if (options.failOn && sql === options.failOn) throw options.error || new Error('database failure');
      if (options.failTarget && sql === 'SELECT value FROM protected_table WHERE id = $1') {
        throw options.error || new Error('target failure');
      }
      if (sql === 'SELECT value FROM protected_table WHERE id = $1') {
        return { rows: [{ value: 'ok' }] };
      }
      return { rows: [] };
    },
    release() { released += 1; },
  };
  return {
    calls,
    released: () => released,
    async connect() { return client; },
  };
}

function actor(tenantId = 'tenant-a') {
  return {
    tenantId,
    principalId: 'principal-1',
    actorType: 'human',
    role: 'county_planner',
    access: 'contributor',
    displayName: 'Planner One',
  };
}

test('tenant query sets transaction-local tenant and timeout before the protected query', async () => {
  const pool = fakePool();
  const query = createPostgresTenantQuery({ pool, tenantId: 'tenant-a', statementTimeoutMs: 7500 });
  const result = await query('SELECT value FROM protected_table WHERE id = $1', ['row-1']);

  assert.deepEqual(result.rows, [{ value: 'ok' }]);
  assert.deepEqual(pool.calls.map((call) => call.sql), [
    'BEGIN',
    "SELECT set_config('app.tenant_id', $1, true)",
    "SELECT set_config('statement_timeout', $1, true)",
    'SELECT value FROM protected_table WHERE id = $1',
    'COMMIT',
  ]);
  assert.deepEqual(pool.calls[1].params, ['tenant-a']);
  assert.deepEqual(pool.calls[2].params, ['7500']);
  assert.deepEqual(pool.calls[3].params, ['row-1']);
  assert.equal(pool.calls.some((call) => call.sql.includes('tenant-a')), false, 'tenant must be parameterized, not interpolated');
  assert.equal(pool.released(), 1);
});

test('target-query failure rolls back, releases the client, and preserves the original error', async () => {
  const original = new Error('original database error');
  original.code = '40001';
  const pool = fakePool({ failTarget: true, error: original });
  const query = createPostgresTenantQuery({ pool, tenantId: 'tenant-a' });

  await assert.rejects(
    () => query('SELECT value FROM protected_table WHERE id = $1', ['row-1']),
    (error) => error === original,
  );
  assert.equal(pool.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(pool.released(), 1);
});

test('tenant-context failure rolls back before any protected query runs', async () => {
  const original = new Error('set_config failed');
  const pool = fakePool({ failOn: "SELECT set_config('app.tenant_id', $1, true)", error: original });
  const query = createPostgresTenantQuery({ pool, tenantId: 'tenant-a' });

  await assert.rejects(
    () => query('SELECT value FROM protected_table WHERE id = $1', ['row-1']),
    (error) => error === original,
  );
  assert.equal(pool.calls.some((call) => call.sql === 'SELECT value FROM protected_table WHERE id = $1'), false);
  assert.equal(pool.calls.at(-1).sql, 'ROLLBACK');
  assert.equal(pool.released(), 1);
});

test('tenant query validates pool, tenant, timeout, statement, and parameter array', async () => {
  assert.throws(() => createPostgresTenantQuery({}), /pool with connect/);
  assert.throws(() => createPostgresTenantQuery({ pool: fakePool(), tenantId: '' }), /tenantId is required/);
  assert.throws(
    () => createPostgresTenantQuery({ pool: fakePool(), tenantId: 'tenant-a', statementTimeoutMs: 100 }),
    /statement timeout must be between 250 and 60000/,
  );
  const query = createPostgresTenantQuery({ pool: fakePool(), tenantId: 'tenant-a' });
  await assert.rejects(() => query('', []), /SQL statement is required/);
  await assert.rejects(() => query('SELECT 1', 'not-an-array'), /SQL parameters must be an array/);
});

test('run-memory factory derives tenant scope only from the validated workspace actor', () => {
  const factory = createPostgresRunMemoryFactory({ pool: fakePool(), statementTimeoutMs: 5000 });
  const tenantA = factory(actor('tenant-a'));
  const tenantB = factory(actor('tenant-b'));
  assert.equal(tenantA.tenantId, 'tenant-a');
  assert.equal(tenantB.tenantId, 'tenant-b');
  assert.notEqual(tenantA, tenantB);
  assert.throws(
    () => factory({ ...actor('tenant-a'), role: 'unknown-role' }),
    /approved workspace role/,
  );
});

test('learning-memory factory derives tenant scope only from the validated workspace actor', () => {
  const factory = createPostgresLearningMemoryFactory({ pool: fakePool(), statementTimeoutMs: 5000 });
  const tenantA = factory(actor('tenant-a'));
  const tenantB = factory(actor('tenant-b'));
  assert.equal(tenantA.tenantId, 'tenant-a');
  assert.equal(tenantB.tenantId, 'tenant-b');
  assert.notEqual(tenantA, tenantB);
  assert.equal(typeof tenantA.recordTrajectory, 'function');
  assert.equal(typeof tenantA.reviewCandidate, 'function');
});

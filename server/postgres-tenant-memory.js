const { SqlInstitutionalMemory } = require('../packages/runtime/sql-institutional-memory');
const { SqlRunMemory } = require('../packages/runtime/sql-run-memory');
const { SqlWorkspaceMemory } = require('../packages/runtime/sql-workspace-memory');
const { validateWorkspaceActor } = require('../packages/runtime/workspace-identity');

function requiredString(value, label, maxLength = 200) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > maxLength) throw new Error(`${label} is too long.`);
  return normalized;
}

function createPostgresTenantQuery(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('PostgreSQL tenant query requires a pool with connect().');
  }
  const tenantId = requiredString(options.tenantId, 'tenantId');
  const statementTimeoutMs = Number.isInteger(options.statementTimeoutMs) ? options.statementTimeoutMs : 10000;
  if (statementTimeoutMs < 250 || statementTimeoutMs > 60000) {
    throw new Error('PostgreSQL statement timeout must be between 250 and 60000 milliseconds.');
  }

  return async function tenantQuery(sql, params = []) {
    if (typeof sql !== 'string' || !sql.trim()) throw new Error('SQL statement is required.');
    if (!Array.isArray(params)) throw new Error('SQL parameters must be an array.');

    const client = await pool.connect();
    if (!client || typeof client.query !== 'function' || typeof client.release !== 'function') {
      throw new Error('PostgreSQL pool returned an invalid client.');
    }

    let began = false;
    try {
      await client.query('BEGIN');
      began = true;
      await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantId]);
      await client.query("SELECT set_config('statement_timeout', $1, true)", [`${statementTimeoutMs}`]);
      const result = await client.query(sql, params);
      await client.query('COMMIT');
      began = false;
      return result;
    } catch (error) {
      if (began) {
        try {
          await client.query('ROLLBACK');
        } catch {
          // Preserve the original database error; the connection is released below.
        }
      }
      throw error;
    } finally {
      client.release();
    }
  };
}

function queryForActorFactory(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.connect !== 'function') {
    throw new Error('PostgreSQL tenant-memory factory requires a pool with connect().');
  }
  return function queryForActor(actorInput) {
    const actor = validateWorkspaceActor(actorInput);
    return {
      actor,
      query: createPostgresTenantQuery({
        pool,
        tenantId: actor.tenantId,
        statementTimeoutMs: options.statementTimeoutMs,
      }),
    };
  };
}

function createPostgresRunMemoryFactory(options = {}) {
  const queryForActor = queryForActorFactory(options);
  return function memoryForActor(actorInput) {
    const { actor, query } = queryForActor(actorInput);
    return new SqlRunMemory({
      tenantId: actor.tenantId,
      query,
      clock: options.clock,
      runsTable: options.runsTable,
      eventsTable: options.eventsTable,
    });
  };
}

function createPostgresWorkspaceMemoryFactory(options = {}) {
  const queryForActor = queryForActorFactory(options);
  return function workspaceMemoryForActor(actorInput) {
    const { actor, query } = queryForActor(actorInput);
    return new SqlWorkspaceMemory({ tenantId: actor.tenantId, query, clock: options.clock });
  };
}

function createPostgresInstitutionalMemoryFactory(options = {}) {
  const queryForActor = queryForActorFactory(options);
  return function institutionalMemoryForActor(actorInput) {
    const { actor, query } = queryForActor(actorInput);
    return new SqlInstitutionalMemory({ tenantId: actor.tenantId, query, clock: options.clock });
  };
}

module.exports = {
  createPostgresInstitutionalMemoryFactory,
  createPostgresRunMemoryFactory,
  createPostgresTenantQuery,
  createPostgresWorkspaceMemoryFactory,
};

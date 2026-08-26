const crypto = require('crypto');

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function identifier(value, label) {
  if (typeof value !== 'string' || !/^[a-z_][a-z0-9_]*$/.test(value)) {
    throw new Error(`${label} must be a safe lowercase SQL identifier.`);
  }
  return value;
}

function requiredString(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  return value.trim();
}

function rowToEvent(row) {
  const payload = row.event && typeof row.event === 'object' ? row.event : JSON.parse(row.event || '{}');
  return {
    ...clone(payload),
    sequence: Number(row.sequence),
    at: row.created_at instanceof Date ? row.created_at.toISOString() : String(row.created_at),
  };
}

class SqlRunMemory {
  constructor(options = {}) {
    if (typeof options.query !== 'function') throw new Error('SqlRunMemory requires an async query(sql, params) function.');
    this.query = options.query;
    this.tenantId = requiredString(options.tenantId, 'tenantId');
    this.clock = options.clock || (() => new Date().toISOString());
    this.runsTable = identifier(options.runsTable || 'agent_runs', 'runsTable');
    this.eventsTable = identifier(options.eventsTable || 'agent_run_events', 'eventsTable');
  }

  async createRun(metadata = {}, runId = crypto.randomUUID()) {
    if (!metadata || typeof metadata !== 'object' || Array.isArray(metadata)) {
      throw new Error('Run metadata must be an object.');
    }
    if (metadata.tenantId !== undefined && requiredString(metadata.tenantId, 'metadata.tenantId') !== this.tenantId) {
      throw new Error('Run metadata tenantId does not match the SQL memory tenant scope.');
    }
    const now = this.clock();
    const product = requiredString(metadata.product || 'cbcap', 'metadata.product');
    const taskType = requiredString(metadata.taskType || 'decision_workflow', 'metadata.taskType');
    const event = { type: 'run_created', metadata: clone(metadata) };
    const sql = `
      WITH inserted AS (
        INSERT INTO ${this.runsTable}
          (run_id, tenant_id, product, task_type, metadata, next_sequence, created_at, updated_at)
        VALUES ($1::uuid, $2, $3, $4, $5::jsonb, 2, $6::timestamptz, $6::timestamptz)
        RETURNING run_id
      )
      INSERT INTO ${this.eventsTable}
        (run_id, tenant_id, sequence, event_type, event, created_at)
      SELECT run_id, $2, 1, 'run_created', $7::jsonb, $6::timestamptz
      FROM inserted
      RETURNING run_id
    `;
    try {
      const result = await this.query(sql, [
        runId,
        this.tenantId,
        product,
        taskType,
        JSON.stringify(metadata),
        now,
        JSON.stringify(event),
      ]);
      if (!result?.rows?.length) throw new Error('Run insert returned no row.');
      return runId;
    } catch (error) {
      if (String(error?.code) === '23505') throw new Error(`Run ${runId} already exists.`);
      throw error;
    }
  }

  async append(runId, event) {
    requiredString(runId, 'runId');
    if (!event || typeof event !== 'object' || Array.isArray(event)) {
      throw new Error('Memory event must be an object.');
    }
    const now = this.clock();
    const eventType = requiredString(event.type, 'event.type');
    const sql = `
      WITH allocated AS (
        UPDATE ${this.runsTable}
        SET next_sequence = next_sequence + 1,
            updated_at = $3::timestamptz
        WHERE run_id = $1::uuid AND tenant_id = $2
        RETURNING next_sequence - 1 AS sequence
      )
      INSERT INTO ${this.eventsTable}
        (run_id, tenant_id, sequence, event_type, event, created_at)
      SELECT $1::uuid, $2, sequence, $4, $5::jsonb, $3::timestamptz
      FROM allocated
      RETURNING sequence, event, created_at
    `;
    const result = await this.query(sql, [
      runId,
      this.tenantId,
      now,
      eventType,
      JSON.stringify(event),
    ]);
    if (!result?.rows?.length) throw new Error(`Unknown run ${runId} for tenant ${this.tenantId}.`);
    return rowToEvent(result.rows[0]);
  }

  async checkpoint(runId, state, details = {}) {
    if (!state || typeof state !== 'object' || Array.isArray(state)) {
      throw new Error('Checkpoint state must be an object.');
    }
    return this.append(runId, {
      type: 'state_checkpoint',
      nodeId: details.nodeId || null,
      step: Number.isInteger(details.step) ? details.step : null,
      status: details.status || state.status || null,
      resumeAt: details.resumeAt || null,
      state: clone(state),
    });
  }

  async read(runId) {
    requiredString(runId, 'runId');
    const sql = `
      SELECT e.sequence, e.event, e.created_at
      FROM ${this.eventsTable} e
      JOIN ${this.runsTable} r
        ON r.run_id = e.run_id AND r.tenant_id = e.tenant_id
      WHERE e.run_id = $1::uuid AND e.tenant_id = $2
      ORDER BY e.sequence ASC
    `;
    const result = await this.query(sql, [runId, this.tenantId]);
    return (result?.rows || []).map(rowToEvent);
  }

  async latestCheckpoint(runId) {
    requiredString(runId, 'runId');
    const sql = `
      SELECT e.sequence, e.event, e.created_at
      FROM ${this.eventsTable} e
      JOIN ${this.runsTable} r
        ON r.run_id = e.run_id AND r.tenant_id = e.tenant_id
      WHERE e.run_id = $1::uuid
        AND e.tenant_id = $2
        AND e.event_type = 'state_checkpoint'
      ORDER BY e.sequence DESC
      LIMIT 1
    `;
    const result = await this.query(sql, [runId, this.tenantId]);
    if (!result?.rows?.length) return null;
    return rowToEvent(result.rows[0]);
  }

  async claimResume(runId, checkpointSequence, event) {
    requiredString(runId, 'runId');
    if (!Number.isInteger(checkpointSequence) || checkpointSequence < 1) {
      throw new Error('checkpointSequence must be a positive integer.');
    }
    if (!event || typeof event !== 'object' || Array.isArray(event) || event.type !== 'run_resumed') {
      throw new Error('Resume claim requires a run_resumed event.');
    }
    const now = this.clock();
    const sql = `
      WITH allocated AS (
        UPDATE ${this.runsTable}
        SET next_sequence = next_sequence + 1,
            updated_at = $4::timestamptz
        WHERE run_id = $1::uuid
          AND tenant_id = $2
          AND next_sequence = $3::bigint + 1
          AND EXISTS (
            SELECT 1
            FROM ${this.eventsTable} checkpoint
            WHERE checkpoint.run_id = $1::uuid
              AND checkpoint.tenant_id = $2
              AND checkpoint.sequence = $3::bigint
              AND checkpoint.event_type = 'state_checkpoint'
              AND checkpoint.event->>'status' = 'awaiting_human_review'
          )
        RETURNING next_sequence - 1 AS sequence
      )
      INSERT INTO ${this.eventsTable}
        (run_id, tenant_id, sequence, event_type, event, created_at)
      SELECT $1::uuid, $2, sequence, 'run_resumed', $5::jsonb, $4::timestamptz
      FROM allocated
      RETURNING sequence, event, created_at
    `;
    const result = await this.query(sql, [
      runId,
      this.tenantId,
      checkpointSequence,
      now,
      JSON.stringify(event),
    ]);
    if (!result?.rows?.length) return null;
    return rowToEvent(result.rows[0]);
  }
}

module.exports = {
  SqlRunMemory,
  identifier,
  rowToEvent,
};

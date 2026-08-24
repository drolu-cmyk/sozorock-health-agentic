const crypto = require('crypto');
const { validateFinding } = require('./monitoring-findings');

function requiredString(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function json(value, fallback = []) {
  if (value === null || value === undefined) return fallback;
  return typeof value === 'string' ? JSON.parse(value) : value;
}

function iso(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString() : String(value);
}

function dateOnly(value) {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value.toISOString().slice(0, 10) : String(value).slice(0, 10);
}

function mapFinding(row) {
  if (!row) return null;
  return {
    id: String(row.id),
    tenantId: row.tenant_id,
    findingKey: row.finding_key,
    monitorId: row.monitor_id,
    subjectId: row.subject_id,
    geographyId: row.geography_id,
    kind: row.kind,
    status: row.status,
    reasonCodes: json(row.reason_codes),
    changedFields: json(row.changed_fields),
    baselineFingerprint: row.baseline_fingerprint,
    currentFingerprint: row.current_fingerprint,
    currentState: row.current_state,
    currentDeadline: dateOnly(row.current_deadline),
    currentValidThrough: dateOnly(row.current_valid_through),
    sourceEntityIds: json(row.source_entity_ids),
    asOf: dateOnly(row.as_of),
    recordedAt: iso(row.recorded_at),
  };
}

class SqlMonitoringFindingStore {
  constructor(options = {}) {
    if (typeof options.query !== 'function') throw new Error('SqlMonitoringFindingStore requires query(sql, params).');
    this.query = options.query;
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.clock = options.clock || (() => new Date().toISOString());
  }

  async append(input) {
    const finding = validateFinding(input, this.tenantId);
    if (!['change_detected', 'attention_required', 'blocked'].includes(finding.status)) {
      throw new Error('Only actionable or blocked monitoring findings are persisted.');
    }
    const id = crypto.randomUUID();
    const result = await this.query(`WITH inserted AS (
      INSERT INTO cbcap_monitor_findings
        (id,tenant_id,finding_key,monitor_id,subject_id,geography_id,kind,status,reason_codes,changed_fields,
         baseline_fingerprint,current_fingerprint,current_state,current_deadline,current_valid_through,source_entity_ids,as_of,recorded_at)
      VALUES ($1::uuid,$2,$3,$4,$5,$6,$7,$8,$9::jsonb,$10::jsonb,$11,$12,$13,$14::date,$15::date,$16::jsonb,$17::date,$18::timestamptz)
      ON CONFLICT (tenant_id,finding_key) DO NOTHING
      RETURNING *
    )
    SELECT * FROM inserted
    UNION ALL
    SELECT * FROM cbcap_monitor_findings WHERE tenant_id=$2 AND finding_key=$3
    LIMIT 1`, [
      id,
      this.tenantId,
      finding.findingKey,
      finding.monitorId,
      finding.subjectId,
      finding.geographyId,
      finding.kind,
      finding.status,
      JSON.stringify(finding.reasonCodes),
      JSON.stringify(finding.changedFields),
      finding.baselineFingerprint,
      finding.currentFingerprint,
      finding.currentState,
      finding.currentDeadline,
      finding.currentValidThrough,
      JSON.stringify(finding.sourceEntityIds),
      finding.asOf,
      this.clock(),
    ]);
    if (!result?.rows?.length) throw new Error('Monitoring finding could not be persisted.');
    return mapFinding(result.rows[0]);
  }

  async list(options = {}) {
    const monitorId = options.monitorId ? requiredString(options.monitorId, 'monitorId', 240) : null;
    const result = await this.query(
      'SELECT * FROM cbcap_monitor_findings WHERE tenant_id=$1 AND ($2::text IS NULL OR monitor_id=$2) ORDER BY recorded_at DESC,id',
      [this.tenantId, monitorId],
    );
    return (result.rows || []).map(mapFinding);
  }
}

module.exports = {
  SqlMonitoringFindingStore,
  mapFinding,
};
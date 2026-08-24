const PERSISTED_STATUSES = new Set(['change_detected', 'attention_required', 'blocked']);

function requiredString(value, label, max = 1000) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function validateFinding(input, tenantId) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new Error('monitoring finding must be an object.');
  const findingKey = requiredString(input.findingKey, 'findingKey', 80);
  if (!/^sha256:[0-9a-f]{64}$/.test(findingKey)) throw new Error('findingKey must be a sha256 hash.');
  if (!Array.isArray(input.reasonCodes) || !input.reasonCodes.length) throw new Error('recorded monitoring findings require at least one reason code.');
  if (!Array.isArray(input.changedFields)) throw new Error('changedFields must be an array.');
  if (!Array.isArray(input.current?.sourceEntityIds)) throw new Error('current.sourceEntityIds must be an array.');
  const status = requiredString(input.status, 'status', 80);
  if (!PERSISTED_STATUSES.has(status)) throw new Error('Only actionable or blocked monitoring findings may be persisted.');
  return {
    tenantId,
    findingKey,
    monitorId: requiredString(input.monitorId, 'monitorId', 240),
    subjectId: requiredString(input.subjectId, 'subjectId', 240),
    geographyId: input.geographyId ? requiredString(input.geographyId, 'geographyId', 240) : null,
    kind: requiredString(input.kind, 'kind', 80),
    status,
    reasonCodes: [...new Set(input.reasonCodes.map((value, index) => requiredString(value, `reasonCodes[${index}]`, 200)))].sort(),
    changedFields: [...new Set(input.changedFields.map((value, index) => requiredString(value, `changedFields[${index}]`, 120)))].sort(),
    baselineFingerprint: input.baseline?.fingerprint || null,
    currentFingerprint: input.current?.fingerprint || null,
    currentState: input.current?.state || null,
    currentDeadline: input.current?.deadline || null,
    currentValidThrough: input.current?.validThrough || null,
    sourceEntityIds: [...new Set(input.current.sourceEntityIds.map((value, index) => requiredString(value, `sourceEntityIds[${index}]`, 500)))],
    asOf: requiredString(input.asOf, 'asOf', 10),
  };
}

class InMemoryMonitoringFindingStore {
  constructor(options = {}) {
    this.tenantId = requiredString(options.tenantId, 'tenantId', 200);
    this.clock = options.clock || (() => new Date().toISOString());
    this.findings = new Map();
  }

  append(input) {
    const normalized = validateFinding(input, this.tenantId);
    const existing = this.findings.get(normalized.findingKey);
    if (existing) return clone(existing);
    const record = {
      ...normalized,
      recordedAt: this.clock(),
    };
    this.findings.set(record.findingKey, clone(record));
    return clone(record);
  }

  list(options = {}) {
    const monitorId = options.monitorId ? requiredString(options.monitorId, 'monitorId', 240) : null;
    return [...this.findings.values()]
      .filter((item) => !monitorId || item.monitorId === monitorId)
      .map(clone);
  }
}

module.exports = {
  InMemoryMonitoringFindingStore,
  validateFinding,
};
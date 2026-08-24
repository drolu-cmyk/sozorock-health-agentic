const { evaluateMonitoring } = require('../packages/cbcap/monitoring');

function requiredString(value, label, max = 240) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function validDateOnly(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function createCBCAPMonitoringApi(options = {}) {
  if (typeof options.definitionForActor !== 'function') throw new Error('Monitoring API requires definitionForActor(actor, monitorId).');
  if (typeof options.snapshotForActor !== 'function') throw new Error('Monitoring API requires snapshotForActor(actor, definition).');
  const definitionForActor = options.definitionForActor;
  const snapshotForActor = options.snapshotForActor;
  const findingStoreForActor = typeof options.findingStoreForActor === 'function' ? options.findingStoreForActor : null;
  const auditSink = typeof options.auditSink === 'function' ? options.auditSink : () => {};
  const clock = typeof options.clock === 'function' ? options.clock : () => new Date();

  return {
    async handle(input, context = {}) {
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        return { statusCode: 400, body: { error: 'request body must be an object' } };
      }
      const unsupported = Object.keys(input).filter((key) => !['monitorId', 'asOf'].includes(key));
      if (unsupported.length) {
        return { statusCode: 400, body: { error: `request contains unsupported fields: ${unsupported.sort().join(', ')}` } };
      }
      let monitorId;
      try {
        monitorId = requiredString(input.monitorId, 'monitorId');
      } catch (error) {
        return { statusCode: 400, body: { error: error.message } };
      }
      const asOf = input.asOf ?? clock().toISOString().slice(0, 10);
      if (!validDateOnly(asOf)) return { statusCode: 400, body: { error: 'asOf must be a valid YYYY-MM-DD date' } };

      const actor = context.workspaceActor;
      if (!actor) return { statusCode: 403, body: { error: 'Authenticated workspace actor is required.' } };

      let definition;
      try {
        definition = await definitionForActor(actor, monitorId);
      } catch {
        return { statusCode: 503, body: { error: 'Governed monitor definition provider is unavailable.' } };
      }
      if (!definition) return { statusCode: 404, body: { error: 'Reviewed monitor definition was not found.' } };

      let snapshot;
      try {
        snapshot = await snapshotForActor(actor, structuredClone(definition), { asOf });
      } catch {
        return { statusCode: 503, body: { error: 'Governed monitor source is unavailable.' } };
      }

      let finding;
      try {
        finding = evaluateMonitoring(definition, snapshot, { asOf });
      } catch {
        return {
          statusCode: 422,
          body: {
            contract: 'cbcap.monitoring.v1',
            monitorId,
            status: 'blocked',
            reasonCodes: ['monitor_evaluation_invalid'],
            notificationRecommended: false,
            humanReviewRequired: true,
            automaticActionTaken: false,
          },
        };
      }

      let persistedFinding = null;
      if (finding.shouldRecordFinding && findingStoreForActor) {
        try {
          const store = await findingStoreForActor(actor);
          if (!store || typeof store.append !== 'function') throw new Error('invalid finding store');
          persistedFinding = await store.append(finding);
        } catch {
          return {
            statusCode: 503,
            body: {
              ...finding,
              error: 'Monitoring finding could not be persisted in the governed tenant store.',
            },
          };
        }
      }

      auditSink({
        action: 'cbcap_monitor_evaluated',
        tenantId: actor.tenantId,
        principalId: actor.principalId,
        role: actor.role,
        monitorId,
        monitorKind: finding.kind,
        status: finding.status,
        findingKey: finding.findingKey,
        persisted: Boolean(persistedFinding),
      });

      return {
        statusCode: finding.status === 'blocked' ? 422 : 200,
        body: {
          ...finding,
          persistedFinding: persistedFinding
            ? { findingKey: persistedFinding.findingKey, recordedAt: persistedFinding.recordedAt }
            : null,
        },
      };
    },
  };
}

module.exports = { createCBCAPMonitoringApi };
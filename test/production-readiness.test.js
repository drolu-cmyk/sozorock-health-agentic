const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEFAULT_PROOF_COUNTIES,
  PROTECTED_TABLES,
  inspectPostgresControlPlane,
  inspectProductionConfiguration,
  probeEvidenceGateway,
  probeTenantIsolation,
  runProductionReadiness,
} = require('../server/production-readiness');

function privilegeRow(table) {
  const expected = new Set(table.privileges);
  return {
    table_name: table.name,
    rls_enabled: true,
    rls_forced: true,
    owned_by_runtime: false,
    can_select: expected.has('SELECT'),
    can_insert: expected.has('INSERT'),
    can_update: expected.has('UPDATE'),
    can_delete: false,
    can_truncate: false,
    can_references: false,
    can_trigger: false,
  };
}

function inspectionPool(overrides = {}) {
  const calls = [];
  const client = {
    async query(sql) {
      calls.push(sql);
      if (/FROM pg_roles/i.test(sql)) return { rows: [{ role_name: 'cbcap_runtime', is_superuser: false, bypass_rls: false }] };
      if (/FROM pg_stat_ssl/i.test(sql)) return { rows: [{ ssl: true }] };
      if (/FROM pg_class c/i.test(sql) && /has_table_privilege/i.test(sql)) {
        const rows = PROTECTED_TABLES.map(privilegeRow);
        if (overrides.table) Object.assign(rows.find((row) => row.table_name === overrides.table.name), overrides.table.patch);
        return { rows };
      }
      if (/FROM pg_policies/i.test(sql)) {
        return { rows: PROTECTED_TABLES.map((table) => ({ table_name: table.name, policy_name: table.policy })) };
      }
      if (/FROM pg_trigger/i.test(sql)) {
        return { rows: PROTECTED_TABLES.filter((table) => table.trigger).map((table) => ({ table_name: table.name, trigger_name: table.trigger })) };
      }
      throw new Error('unexpected query');
    },
    release() {},
  };
  return {
    calls,
    async connect() { return client; },
  };
}

test('database readiness requires TLS, non-superuser non-BYPASSRLS role, forced RLS, exact policies, triggers, and least privileges', async () => {
  const result = await inspectPostgresControlPlane({ pool: inspectionPool() });
  assert.equal(result.ok, true);
  assert.equal(result.tls, true);
  assert.equal(result.tables.length, PROTECTED_TABLES.length);
  assert.equal(result.tables.every((table) => table.ready), true);
});

test('database readiness fails on excess mutable privilege even when RLS exists', async () => {
  const result = await inspectPostgresControlPlane({
    pool: inspectionPool({ table: { name: 'cbcap_monitor_findings', patch: { can_delete: true } } }),
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('excess_delete_privilege:cbcap_monitor_findings'));
});

function isolationPool(options = {}) {
  let tenant = null;
  let status = null;
  let rolledBack = false;
  const client = {
    async query(sql, params = []) {
      if (sql === 'BEGIN') return { rows: [] };
      if (sql === 'ROLLBACK') { rolledBack = true; tenant = null; status = null; return { rows: [] }; }
      if (/set_config\('app\.tenant_id'/i.test(sql)) { tenant = params[0]; return { rows: [{ set_config: tenant }] }; }
      if (/INSERT INTO cbcap_workspace_items/i.test(sql)) { status = 'probe'; return { rowCount: 1, rows: [] }; }
      if (/SELECT count\(\*\)::int AS count FROM cbcap_workspace_items WHERE tenant_id=/i.test(sql)) {
        return { rows: [{ count: tenant === params[0] && status !== null ? 1 : 0 }] };
      }
      if (/SELECT count\(\*\)::int AS count FROM cbcap_workspace_items WHERE workspace_id=/i.test(sql)) {
        return { rows: [{ count: options.crossTenantLeak ? 1 : 0 }] };
      }
      if (/UPDATE cbcap_workspace_items SET status='cross-tenant-write'/i.test(sql)) {
        if (options.crossTenantWrite) { status = 'cross-tenant-write'; return { rowCount: 1, rows: [] }; }
        return { rowCount: 0, rows: [] };
      }
      if (/SELECT status FROM cbcap_workspace_items/i.test(sql)) return { rows: [{ status }] };
      if (/current_setting\('app\.tenant_id'/i.test(sql)) return { rows: [{ tenant_id: rolledBack ? null : tenant }] };
      throw new Error(`unexpected query: ${sql}`);
    },
    release() {},
  };
  return { async connect() { return client; } };
}

test('tenant isolation probe proves same-tenant visibility, cross-tenant denial, write denial, and transaction-local context cleanup', async () => {
  const result = await probeTenantIsolation({ pool: isolationPool(), tenantA: 'tenant-a', tenantB: 'tenant-b' });
  assert.deepEqual(result, { ok: true, issues: [] });
});

test('tenant isolation probe blocks activation if a cross-tenant read is visible', async () => {
  const result = await probeTenantIsolation({ pool: isolationPool({ crossTenantLeak: true }), tenantA: 'tenant-a', tenantB: 'tenant-b' });
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('cross_tenant_read_succeeded'));
});

function evidencePackage(countyFips, releaseId = 'release-1') {
  return {
    countyFips,
    releaseId,
    releaseHash: `sha256:${countyFips.padEnd(64, '0')}`,
    package: {
      planning_contract_version: 'sozorock.evidence-gateway.planning.v1',
      planning_documents: [],
      planning_claims: [],
      planning_citations: [],
    },
  };
}

test('Evidence Gateway production probe requires the locked five counties on one release with planning contract', async () => {
  const seen = [];
  const result = await probeEvidenceGateway({
    evidenceClient: {
      async getCountyPackage(countyFips) {
        seen.push(countyFips);
        return evidencePackage(countyFips);
      },
    },
  });
  assert.equal(result.ok, true);
  assert.deepEqual(seen, DEFAULT_PROOF_COUNTIES);
  assert.equal(result.counties.length, 5);
});

test('Evidence Gateway production probe fails closed on release drift or missing planning contract', async () => {
  const result = await probeEvidenceGateway({
    evidenceClient: {
      async getCountyPackage(countyFips) {
        const value = evidencePackage(countyFips, countyFips === '36093' ? 'release-2' : 'release-1');
        if (countyFips === '48029') delete value.package.planning_contract_version;
        return value;
      },
    },
  });
  assert.equal(result.ok, false);
  assert.ok(result.issues.includes('release_id_inconsistent:36093'));
  assert.ok(result.issues.includes('planning_contract_missing:48029'));
});

test('production configuration disables development/legacy bypass and requires explicit HTTPS origins and AWS region', () => {
  const good = inspectProductionConfiguration({ env: {
    ENABLE_UNAUTHENTICATED_CBCAP_DEV: 'false',
    ENABLE_LEGACY_SESSIONS: 'false',
    AGENTIC_ALLOWED_ORIGINS: 'https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org',
    AWS_REGION: 'us-east-1',
  } });
  assert.equal(good.ok, true);

  const bad = inspectProductionConfiguration({ env: {
    ENABLE_UNAUTHENTICATED_CBCAP_DEV: 'true',
    ENABLE_LEGACY_SESSIONS: 'true',
    AGENTIC_ALLOWED_ORIGINS: '*',
  } });
  assert.equal(bad.ok, false);
  assert.ok(bad.issues.includes('unauthenticated_dev_mode_enabled'));
  assert.ok(bad.issues.includes('legacy_sessions_enabled'));
  assert.ok(bad.issues.includes('aws_region_missing_or_invalid'));
});

test('full activation gate stays blocked if any target-environment proof is missing', async () => {
  const result = await runProductionReadiness({
    env: {
      AGENTIC_ALLOWED_ORIGINS: 'https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org',
      AWS_REGION: 'us-east-1',
    },
    pool: inspectionPool(),
    tenantA: 'tenant-a',
    tenantB: 'tenant-b',
    evidenceClient: { async getCountyPackage(county) { return evidencePackage(county); } },
    identityProbe: async () => ({ claimsVerified: true, sameTenantAuthorized: true, crossTenantDenied: true, humanReviewAuthorityVerified: true }),
    recoveryProbe: async () => ({ backupVerified: true, restoreVerified: true }),
    observabilityProbe: async () => ({ logsReachable: true, auditEventsReachable: true, alertsConfigured: true, incidentRouteConfigured: true }),
    // rollback probe intentionally omitted
  });
  assert.equal(result.ready, false);
  assert.equal(result.activationDecision, 'blocked');
  assert.ok(result.issues.includes('rollback:rollback_probe_unavailable'));
});

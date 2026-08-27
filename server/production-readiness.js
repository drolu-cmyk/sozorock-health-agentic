const crypto = require('crypto');
const { readProductionAgentConfig } = require('./production-agent-runtime');
const { loadCountyArtifact } = require('../packages/data/national-counties');
const { loadZipArtifact } = require('../packages/data/zip-crosswalk');

const DEFAULT_PROOF_COUNTIES = Object.freeze(['36001', '36093', '36057', '42029', '48029']);
const PLANNING_CONTRACT = 'sozorock.evidence-gateway.planning.v1';
const SHA256 = /^sha256:[0-9a-f]{64}$/;

const DEPLOYMENT_PROOF_FIELDS = Object.freeze([
  'oidcIdentityVerified',
  'deploymentAccountVerified',
  'protectedMainShaVerified',
  'immutableImageVerified',
  'vulnerabilityScanClean',
  'managedSecretsVerified',
  'privateEvidenceStorageVerified',
  'databaseNetworkIsolationVerified',
  'migrationsCompletedBeforeTraffic',
  'runtimeEnabledAfterMigrations',
  'tlsCertificateVerified',
  'edgeProtectionVerified',
  'securityHeadersVerified',
  'corsBoundaryVerified',
  'unauthenticatedProtectedRouteDenied',
  'cognitoPkceHostedUiVerified',
]);

const MODEL_PROOF_FIELDS = Object.freeze([
  'structuredOutputVerified',
  'specialistSequenceVerified',
  'countyReleaseBound',
  'humanReviewPreserved',
  'modelIdentityVerified',
  'promptVersionVerified',
  'outputHashRecorded',
  'responseIdHashRecorded',
]);

const PROTECTED_TABLES = Object.freeze([
  { name: 'agent_runs', policy: 'agent_runs_tenant_scope', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
  { name: 'agent_run_events', policy: 'agent_run_events_tenant_scope', trigger: 'agent_run_events_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_workspace_items', policy: 'cbcap_workspace_items_tenant_scope', privileges: ['SELECT', 'INSERT', 'UPDATE'] },
  { name: 'cbcap_workspace_events', policy: 'cbcap_workspace_events_tenant_scope', trigger: 'cbcap_workspace_events_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_institutional_memory', policy: 'cbcap_institutional_memory_tenant_scope', trigger: 'cbcap_institutional_memory_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_learning_trajectory', policy: 'cbcap_learning_trajectory_tenant_scope', trigger: 'cbcap_learning_trajectory_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_learning_evaluations', policy: 'cbcap_learning_evaluations_tenant_scope', trigger: 'cbcap_learning_evaluations_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_learning_corrections', policy: 'cbcap_learning_corrections_tenant_scope', trigger: 'cbcap_learning_corrections_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_learning_candidates', policy: 'cbcap_learning_candidates_tenant_scope', trigger: 'cbcap_learning_candidates_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_learning_candidate_reviews', policy: 'cbcap_learning_candidate_reviews_tenant_scope', trigger: 'cbcap_learning_candidate_reviews_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_monitor_findings', policy: 'cbcap_monitor_findings_tenant_scope', trigger: 'cbcap_monitor_findings_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_tenant_evidence_documents', policy: 'cbcap_tenant_evidence_documents_tenant_isolation', trigger: 'cbcap_tenant_evidence_documents_append_only', privileges: ['SELECT', 'INSERT'] },
  { name: 'cbcap_tenant_evidence_reviews', policy: 'cbcap_tenant_evidence_reviews_tenant_isolation', trigger: 'cbcap_tenant_evidence_reviews_append_only', privileges: ['SELECT', 'INSERT'] },
]);

const ALL_PRIVILEGES = Object.freeze(['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']);

function requiredString(value, label, max = 500) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized.length > max) throw new Error(`${label} is too long.`);
  return normalized;
}

function unique(values) {
  return [...new Set(values)].sort();
}

function safeIssue(code, detail = null) {
  return detail ? `${code}:${detail}` : code;
}

async function inspectPostgresControlPlane(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.connect !== 'function') {
    return { ok: false, issues: ['database_pool_unavailable'], tables: [] };
  }
  const schema = options.schema || 'public';
  let client;
  try {
    client = await pool.connect();
    const roleResult = await client.query(`
      SELECT current_user AS role_name,
             r.rolsuper AS is_superuser,
             r.rolbypassrls AS bypass_rls
        FROM pg_roles r
       WHERE r.rolname = current_user
    `);
    const sslResult = await client.query('SELECT ssl FROM pg_stat_ssl WHERE pid = pg_backend_pid()');
    const tableNames = PROTECTED_TABLES.map((item) => item.name);
    const tableResult = await client.query(`
      SELECT c.relname AS table_name,
             c.relrowsecurity AS rls_enabled,
             c.relforcerowsecurity AS rls_forced,
             pg_get_userbyid(c.relowner) = current_user AS owned_by_runtime,
             has_table_privilege(current_user, c.oid, 'SELECT') AS can_select,
             has_table_privilege(current_user, c.oid, 'INSERT') AS can_insert,
             has_table_privilege(current_user, c.oid, 'UPDATE') AS can_update,
             has_table_privilege(current_user, c.oid, 'DELETE') AS can_delete,
             has_table_privilege(current_user, c.oid, 'TRUNCATE') AS can_truncate,
             has_table_privilege(current_user, c.oid, 'REFERENCES') AS can_references,
             has_table_privilege(current_user, c.oid, 'TRIGGER') AS can_trigger
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1
         AND c.relkind IN ('r','p')
         AND c.relname = ANY($2::text[])
       ORDER BY c.relname
    `, [schema, tableNames]);
    const policyResult = await client.query(`
      SELECT tablename AS table_name, policyname AS policy_name
        FROM pg_policies
       WHERE schemaname = $1
         AND tablename = ANY($2::text[])
       ORDER BY tablename, policyname
    `, [schema, tableNames]);
    const triggerResult = await client.query(`
      SELECT c.relname AS table_name, t.tgname AS trigger_name
        FROM pg_trigger t
        JOIN pg_class c ON c.oid = t.tgrelid
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = $1
         AND c.relname = ANY($2::text[])
         AND NOT t.tgisinternal
         AND t.tgenabled <> 'D'
       ORDER BY c.relname, t.tgname
    `, [schema, tableNames]);

    const issues = [];
    const role = roleResult.rows?.[0];
    if (!role) issues.push('runtime_role_not_resolved');
    if (role?.is_superuser) issues.push('runtime_role_is_superuser');
    if (role?.bypass_rls) issues.push('runtime_role_has_bypassrls');
    if (sslResult.rows?.[0]?.ssl !== true) issues.push('database_connection_not_tls');

    const rowsByTable = new Map((tableResult.rows || []).map((row) => [row.table_name, row]));
    const policies = new Map();
    for (const row of policyResult.rows || []) {
      if (!policies.has(row.table_name)) policies.set(row.table_name, new Set());
      policies.get(row.table_name).add(row.policy_name);
    }
    const triggers = new Map();
    for (const row of triggerResult.rows || []) {
      if (!triggers.has(row.table_name)) triggers.set(row.table_name, new Set());
      triggers.get(row.table_name).add(row.trigger_name);
    }

    const tables = [];
    for (const expected of PROTECTED_TABLES) {
      const row = rowsByTable.get(expected.name);
      if (!row) {
        issues.push(safeIssue('protected_table_missing', expected.name));
        tables.push({ table: expected.name, ready: false });
        continue;
      }
      const tableIssues = [];
      if (row.rls_enabled !== true) tableIssues.push('rls_not_enabled');
      if (row.rls_forced !== true) tableIssues.push('rls_not_forced');
      if (row.owned_by_runtime === true) tableIssues.push('runtime_owns_table');
      if (!policies.get(expected.name)?.has(expected.policy)) tableIssues.push('tenant_policy_missing');
      if (expected.trigger && !triggers.get(expected.name)?.has(expected.trigger)) tableIssues.push('append_only_trigger_missing');

      for (const privilege of ALL_PRIVILEGES) {
        const column = `can_${privilege.toLowerCase()}`;
        const shouldHave = expected.privileges.includes(privilege);
        if (Boolean(row[column]) !== shouldHave) {
          tableIssues.push(`${shouldHave ? 'missing' : 'excess'}_${privilege.toLowerCase()}_privilege`);
        }
      }
      for (const issue of tableIssues) issues.push(`${issue}:${expected.name}`);
      tables.push({ table: expected.name, ready: tableIssues.length === 0, issues: tableIssues });
    }

    return {
      ok: issues.length === 0,
      role: role?.role_name || null,
      tls: sslResult.rows?.[0]?.ssl === true,
      tables,
      issues: unique(issues),
    };
  } catch {
    return { ok: false, issues: ['database_inspection_failed'], tables: [] };
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

async function probeTenantIsolation(options = {}) {
  const pool = options.pool;
  if (!pool || typeof pool.connect !== 'function') return { ok: false, issues: ['database_pool_unavailable'] };
  let tenantA;
  let tenantB;
  try {
    tenantA = requiredString(options.tenantA, 'tenantA', 200);
    tenantB = requiredString(options.tenantB, 'tenantB', 200);
  } catch {
    return { ok: false, issues: ['tenant_probe_identity_invalid'] };
  }
  if (tenantA === tenantB) return { ok: false, issues: ['tenant_probe_identities_must_differ'] };

  const itemId = crypto.randomUUID();
  const workspaceId = `preflight-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  let client;
  let began = false;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    began = true;
    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
    await client.query(`
      INSERT INTO cbcap_workspace_items
        (id,tenant_id,workspace_id,geography_id,item_type,title,content,status,version,created_by,created_at,updated_by,updated_at)
      VALUES ($1::uuid,$2,$3,NULL,'task','production readiness isolation probe','{}'::jsonb,'probe',1,'production-readiness',$4::timestamptz,'production-readiness',$4::timestamptz)
    `, [itemId, tenantA, workspaceId, now]);
    const aVisible = await client.query(
      'SELECT count(*)::int AS count FROM cbcap_workspace_items WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3::uuid',
      [tenantA, workspaceId, itemId],
    );

    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantB]);
    const bVisible = await client.query(
      'SELECT count(*)::int AS count FROM cbcap_workspace_items WHERE workspace_id=$1 AND id=$2::uuid',
      [workspaceId, itemId],
    );
    const bUpdate = await client.query(
      "UPDATE cbcap_workspace_items SET status='cross-tenant-write' WHERE workspace_id=$1 AND id=$2::uuid",
      [workspaceId, itemId],
    );

    await client.query("SELECT set_config('app.tenant_id', $1, true)", [tenantA]);
    const aAfter = await client.query(
      'SELECT status FROM cbcap_workspace_items WHERE tenant_id=$1 AND workspace_id=$2 AND id=$3::uuid',
      [tenantA, workspaceId, itemId],
    );
    await client.query('ROLLBACK');
    began = false;
    const cleared = await client.query("SELECT nullif(current_setting('app.tenant_id', true), '') AS tenant_id");

    const issues = [];
    if (aVisible.rows?.[0]?.count !== 1) issues.push('same_tenant_read_failed');
    if (bVisible.rows?.[0]?.count !== 0) issues.push('cross_tenant_read_succeeded');
    if (bUpdate.rowCount !== 0) issues.push('cross_tenant_write_succeeded');
    if (aAfter.rows?.[0]?.status !== 'probe') issues.push('cross_tenant_mutation_observed');
    if (cleared.rows?.[0]?.tenant_id !== null) issues.push('tenant_context_leaked_after_transaction');
    return { ok: issues.length === 0, issues };
  } catch {
    if (began && client) {
      try { await client.query('ROLLBACK'); } catch {}
    }
    return { ok: false, issues: ['tenant_isolation_probe_failed'] };
  } finally {
    if (client && typeof client.release === 'function') client.release();
  }
}

async function probeEvidenceGateway(options = {}) {
  const evidenceClient = options.evidenceClient;
  if (!evidenceClient || typeof evidenceClient.getCountyPackage !== 'function') {
    return { ok: false, issues: ['evidence_gateway_client_unavailable'], counties: [] };
  }
  const counties = Array.isArray(options.counties) && options.counties.length ? options.counties : DEFAULT_PROOF_COUNTIES;
  const results = [];
  const issues = [];
  let releaseId = null;
  for (const county of counties) {
    const fips = String(county || '').trim();
    if (!/^\d{5}$/.test(fips)) {
      issues.push(safeIssue('evidence_probe_county_invalid', fips || 'empty'));
      continue;
    }
    try {
      const result = await evidenceClient.getCountyPackage(fips);
      const countyIssues = [];
      if (result?.countyFips !== fips) countyIssues.push('county_mismatch');
      try {
        requiredString(result?.releaseId, 'releaseId', 500);
      } catch {
        countyIssues.push('release_id_missing');
      }
      if (!SHA256.test(String(result?.releaseHash || ''))) countyIssues.push('release_hash_invalid');
      if (result?.package?.planning_contract_version !== PLANNING_CONTRACT) countyIssues.push('planning_contract_missing');
      if (!Array.isArray(result?.package?.planning_documents)) countyIssues.push('planning_documents_missing');
      if (!Array.isArray(result?.package?.planning_claims)) countyIssues.push('planning_claims_missing');
      if (!Array.isArray(result?.package?.planning_citations)) countyIssues.push('planning_citations_missing');
      if (releaseId === null) releaseId = result?.releaseId || null;
      else if (result?.releaseId !== releaseId) countyIssues.push('release_id_inconsistent');
      for (const issue of countyIssues) issues.push(`${issue}:${fips}`);
      results.push({ countyFips: fips, ready: countyIssues.length === 0, releaseId: result?.releaseId || null, releaseHash: result?.releaseHash || null });
    } catch {
      issues.push(safeIssue('evidence_gateway_probe_failed', fips));
      results.push({ countyFips: fips, ready: false, releaseId: null, releaseHash: null });
    }
  }
  return { ok: issues.length === 0 && results.length === counties.length, releaseId, counties: results, issues: unique(issues) };
}

async function runNamedProbe(name, probe, requiredFields) {
  if (typeof probe !== 'function') return { ok: false, issues: [`${name}_probe_unavailable`] };
  try {
    const result = await probe();
    const issues = [];
    for (const field of requiredFields) {
      if (result?.[field] !== true) issues.push(`${name}_${field}_not_verified`);
    }
    return { ok: issues.length === 0, issues, evidence: result || null };
  } catch {
    return { ok: false, issues: [`${name}_probe_failed`] };
  }
}

function inspectProductionConfiguration(options = {}) {
  const env = options.env || process.env;
  const issues = [];
  if (String(env.ENABLE_UNAUTHENTICATED_CBCAP_DEV || '').toLowerCase() === 'true') issues.push('unauthenticated_dev_mode_enabled');
  if (String(env.ENABLE_LEGACY_SESSIONS || '').toLowerCase() === 'true') issues.push('legacy_sessions_enabled');

  const origins = String(env.AGENTIC_ALLOWED_ORIGINS || '').split(';').map((item) => item.trim()).filter(Boolean);
  if (!origins.length) issues.push('allowed_origins_not_explicit');
  for (const origin of origins) {
    if (origin === '*' || !origin.startsWith('https://')) issues.push('allowed_origin_not_https_or_wildcard');
  }
  if (!origins.includes('https://cbcap.sozorockfoundation.org')) issues.push('cbcap_origin_missing');
  if (!origins.includes('https://health.sozorockfoundation.org')) issues.push('health_origin_missing');

  const hosts = String(env.AGENTIC_ALLOWED_HOSTS || '').split(';').map((item) => item.trim().toLowerCase()).filter(Boolean);
  if (!hosts.length) issues.push('allowed_hosts_not_explicit');
  for (const host of hosts) {
    if (host === '*' || host.includes('://') || !/^[a-z0-9.-]+$/.test(host)) issues.push('allowed_host_invalid_or_wildcard');
  }

  const region = String(env.AWS_REGION || '').trim();
  if (!/^[a-z]{2}(?:-gov)?-[a-z]+-\d$/.test(region)) issues.push('aws_region_missing_or_invalid');
  let agent = null;
  try {
    const config = readProductionAgentConfig(env);
    agent = {
      model: config.model,
      promptVersion: config.promptVersion,
      killSwitchEnabled: config.killSwitchEnabled,
    };
    if (config.killSwitchEnabled) issues.push('agent_kill_switch_enabled');
  } catch {
    issues.push('agent_configuration_missing_or_invalid');
  }
  return {
    ok: issues.length === 0,
    issues: unique(issues),
    allowedOrigins: origins,
    allowedHosts: hosts,
    awsRegion: region || null,
    agent,
  };
}

function inspectNationalGeographyData(options = {}) {
  if (typeof options.geographyProbe === 'function') {
    try {
      const result = options.geographyProbe();
      return result && typeof result.then !== 'function'
        ? result
        : { ok: false, issues: ['geography_probe_must_be_synchronous'] };
    } catch {
      return { ok: false, issues: ['geography_probe_failed'] };
    }
  }
  const issues = [];
  let counties = null;
  let postalGeography = null;
  try {
    const loaded = loadCountyArtifact({ production: true });
    counties = {
      count: loaded.validation.count,
      stateCount: loaded.validation.stateCount,
      version: loaded.artifact.version || null,
      effectiveDate: loaded.artifact.effectiveDate || null,
      sourceSha256: loaded.artifact.source?.sha256 || null,
    };
  } catch {
    issues.push('national_counties_not_ready');
  }
  try {
    const loaded = loadZipArtifact({ production: true });
    postalGeography = {
      activeMethod: loaded.method,
      geographyKind: loaded.method === 'census_zcta_proxy' ? 'census_zcta_proxy' : 'usps_zip_crosswalk',
      geographyCount: loaded.validation.geographyCount,
      countyCount: loaded.validation.countyCount,
      relationshipCount: loaded.validation.relationshipCount,
      version: loaded.artifact.version || null,
      effectiveDate: loaded.artifact.effectiveDate || null,
      sourceSha256: loaded.artifact.source?.sha256 || null,
      caveat: loaded.method === 'census_zcta_proxy' ? loaded.artifact.caveat : null,
    };
  } catch {
    issues.push('postal_geography_not_ready');
  }
  return { ok: issues.length === 0, counties, postalGeography, issues };
}

async function runProductionReadiness(options = {}) {
  const configuration = inspectProductionConfiguration(options);
  const nationalGeography = inspectNationalGeographyData(options);
  const database = await inspectPostgresControlPlane(options);
  const tenantIsolation = await probeTenantIsolation(options);
  const evidenceGateway = await probeEvidenceGateway(options);
  const identity = await runNamedProbe('identity', options.identityProbe, [
    'claimsVerified',
    'sameTenantAuthorized',
    'crossTenantDenied',
    'humanReviewAuthorityVerified',
  ]);
  const deployment = await runNamedProbe('deployment', options.deploymentProbe, DEPLOYMENT_PROOF_FIELDS);
  const model = await runNamedProbe('model', options.modelProbe, MODEL_PROOF_FIELDS);
  const recovery = await runNamedProbe('recovery', options.recoveryProbe, [
    'backupVerified',
    'restoreVerified',
  ]);
  const observability = await runNamedProbe('observability', options.observabilityProbe, [
    'logsReachable',
    'auditEventsReachable',
    'alertsConfigured',
    'incidentRouteConfigured',
  ]);
  const rollback = await runNamedProbe('rollback', options.rollbackProbe, [
    'institutionalDisableVerified',
    'publicExploreUnaffected',
    'evidenceGatewayUnaffected',
  ]);

  const sections = { configuration, nationalGeography, database, tenantIsolation, evidenceGateway, identity, deployment, model, recovery, observability, rollback };
  const issues = unique(Object.entries(sections).flatMap(([section, result]) => (result.issues || []).map((issue) => `${section}:${issue}`)));
  return {
    contract: 'cbcap.production-readiness.v1',
    ready: issues.length === 0 && Object.values(sections).every((section) => section.ok === true),
    checkedAt: new Date().toISOString(),
    sections,
    issues,
    activationDecision: issues.length === 0 ? 'eligible_for_controlled_activation' : 'blocked',
  };
}

module.exports = {
  DEFAULT_PROOF_COUNTIES,
  DEPLOYMENT_PROOF_FIELDS,
  MODEL_PROOF_FIELDS,
  PLANNING_CONTRACT,
  PROTECTED_TABLES,
  inspectPostgresControlPlane,
  inspectNationalGeographyData,
  inspectProductionConfiguration,
  probeEvidenceGateway,
  probeTenantIsolation,
  runProductionReadiness,
};

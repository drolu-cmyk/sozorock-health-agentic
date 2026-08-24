const test = require('node:test');
const assert = require('node:assert/strict');
const {
  DEPLOYMENT_PROOF_FIELDS,
  runProductionReadiness,
} = require('../server/production-readiness');

const EXPECTED_FIELDS = [
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
];

test('deployment proof preserves the release and edge safeguards from the superseded infrastructure draft', () => {
  assert.deepEqual(DEPLOYMENT_PROOF_FIELDS, EXPECTED_FIELDS);
});

test('one failed deployment supply-chain proof blocks production activation', async () => {
  const evidence = Object.fromEntries(EXPECTED_FIELDS.map((field) => [field, true]));
  evidence.vulnerabilityScanClean = false;

  const report = await runProductionReadiness({
    env: {
      AGENTIC_ALLOWED_ORIGINS: 'https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org',
      AGENTIC_ALLOWED_HOSTS: 'api.cbcap.sozorockfoundation.org',
      AWS_REGION: 'us-east-1',
    },
    deploymentProbe: async () => evidence,
  });

  assert.equal(report.ready, false);
  assert.equal(report.activationDecision, 'blocked');
  assert.ok(report.issues.includes('deployment:deployment_vulnerabilityScanClean_not_verified'));
});

test('missing deployment probe is never treated as not applicable', async () => {
  const report = await runProductionReadiness({
    env: {
      AGENTIC_ALLOWED_ORIGINS: 'https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org',
      AGENTIC_ALLOWED_HOSTS: 'api.cbcap.sozorockfoundation.org',
      AWS_REGION: 'us-east-1',
    },
  });
  assert.ok(report.issues.includes('deployment:deployment_probe_unavailable'));
});

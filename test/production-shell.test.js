const test = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const path = require('node:path');

for (const file of ['deploy-production-runtime.sh', 'live-cognito-probe.sh']) {
  test(`${file} has valid bash syntax`, () => {
    const script = path.join(__dirname, '..', 'scripts', file);
    const result = spawnSync('bash', ['-n', script], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
  });
}

test('live Cognito proof uses the deployed production client rather than a temporary client', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'live-cognito-probe.sh'), 'utf8');
  assert.match(script, /USER_POOL_CLIENT_ID/);
  assert.match(script, /cognito-srp-auth\.js/);
  assert.doesNotMatch(script, /create-user-pool-client/);
  assert.doesNotMatch(script, /delete-user-pool-client/);
});

test('live proof exercises tenant-private evidence metadata resolution', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'live-cognito-probe.sh'), 'utf8');
  assert.match(script, /api\/cbcap\/private-evidence\/submissions/);
  assert.match(script, /private_evidence_status/);
  assert.match(script, /privateEvidenceMetadataLookupVerified:true/);
});

test('live proof rejects legacy frontend and unauthenticated place routes', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'live-cognito-probe.sh'), 'utf8');
  assert.match(script, /legacy_root_status/);
  assert.match(script, /legacy_place_status/);
  assert.match(script, /legacy_health_status/);
  assert.match(script, /institutionalApiBoundaryVerified:true/);
  assert.match(script, /legacyPlaceApiDenied:true/);
});

test('live proof exercises the five-county Evidence Gateway visualization workspace and render claim', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'live-cognito-probe.sh'), 'utf8');
  assert.match(script, /api\/cbcap\/visualizations\/workspace/);
  assert.match(script, /36001.*36093.*36057.*42029.*48029/);
  assert.match(script, /LACKTRPT:Crude/);
  assert.match(script, /cbcap\.visualization-workspace\.v1/);
  assert.match(script, /cbcap\.visualization-render-package\.v1/);
  assert.match(script, /visualizationWorkspaceVerified:true/);
  assert.match(script, /visualizationWorkspaceFiveCountyEvidenceVerified:true/);
  assert.match(script, /visualizationWorkspaceRenderClaimVerified:true/);
  assert.match(script, /compositeScore == null/);
});

test('deployment script binds the live probe to the stack client and fails closed to zero tasks', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-production-runtime.sh'), 'utf8');
  assert.match(script, /USER_POOL_CLIENT_ID=\$\(stack_output UserPoolClientId\)/);
  assert.match(script, /USER_POOL_CLIENT_ID="\$USER_POOL_CLIENT_ID" API_DOMAIN/);
  assert.match(script, /bash scripts\/live-cognito-probe\.sh/);
  assert.match(script, /DesiredCount=0 ActivationEnabled=false/);
  assert.match(script, /productionAppClientVerified/);
});

test('production workflow deploys only the exact triggering commit', () => {
  const workflow = readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-production-runtime.yml'), 'utf8');
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref: main/);
  assert.match(workflow, /RELEASE_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /test "\$approved_commit" = "\$RELEASE_SHA"/);
  assert.match(workflow, /test "\$origin_main" = "\$approved_commit"/);
});

test('production image excludes the retired demonstration frontend', () => {
  const dockerfile = readFileSync(path.join(__dirname, '..', 'Dockerfile.runtime'), 'utf8');
  assert.doesNotMatch(dockerfile, /^COPY frontend\b/m);
  assert.match(dockerfile, /CMD \["node", "server\/production-index\.js"\]/);
});

test('production template composes private evidence without the obsolete SSM placeholder', () => {
  const template = readFileSync(path.join(__dirname, '..', 'infrastructure', 'cloudformation', 'cbcap-agentic-runtime.yml'), 'utf8');
  assert.doesNotMatch(template, /CommonContainerEnvironment/);
  assert.doesNotMatch(template, /AWS::SSM::Parameter/);
  assert.match(template, /CB_CAP_PRIVATE_EVIDENCE_BUCKET/);
  assert.match(template, /CB_CAP_PRIVATE_EVIDENCE_KMS_KEY_ARN/);
  assert.match(template, /PolicyName: ReadTenantPrivateEvidenceMetadata/);
  assert.match(template, /Action: s3:ListBucket/);
  assert.match(template, /- s3:GetObject/);
  assert.doesNotMatch(template, /s3:PutObject\n\s+Resource: !Sub '\$\{PrivateEvidenceBucket\.Arn\}\/tenant-evidence/);
});

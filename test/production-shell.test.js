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
  assert.match(script, /apiHealthForwarded:true/);
});

test('production Cognito uses Hosted UI authorization-code PKCE with exact UI redirects and no implicit flow', () => {
  const template = readFileSync(path.join(__dirname, '..', 'infrastructure', 'cloudformation', 'cbcap-agentic-runtime.yml'), 'utf8');
  const deploy = readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-production-runtime.sh'), 'utf8');
  assert.match(template, /AllowedOAuthFlows: \[code\]/);
  assert.doesNotMatch(template, /AllowedOAuthFlows:.*implicit/);
  assert.match(template, /CallbackURLs: \['https:\/\/cbcap\.sozorockfoundation\.org\/auth\/callback'\]/);
  assert.match(template, /LogoutURLs: \['https:\/\/cbcap\.sozorockfoundation\.org\/'\]/);
  assert.match(template, /AWS::Cognito::UserPoolDomain/);
  assert.match(template, /CognitoHostedUiDomain:/);
  assert.match(template, /CognitoIssuerUrl:/);
  assert.match(deploy, /authorization_code_pkce/);
  assert.match(deploy, /describe-user-pool-domain/);
  assert.match(deploy, /ui-runtime-config\.json/);
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

test('live proof runs the bounded structured model path and records only model identifiers and hashes', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'live-cognito-probe.sh'), 'utf8');
  assert.match(script, /cbcap\.agent-run\.v1/);
  assert.match(script, /synthesize_governed_evidence.*draft_reviewable_planning_brief/);
  assert.match(script, /completed_requires_human_review/);
  assert.match(script, /agentResponseIdHash/);
  assert.match(script, /agentOutputHash/);
  assert.doesNotMatch(script, /responseId:[^H]/);
});

test('deployment script binds the live probe to the stack client and fails closed to zero tasks', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-production-runtime.sh'), 'utf8');
  assert.match(script, /USER_POOL_CLIENT_ID=\$\(stack_output UserPoolClientId\)/);
  assert.match(script, /USER_POOL_CLIENT_ID="\$USER_POOL_CLIENT_ID" API_DOMAIN/);
  assert.match(script, /bash scripts\/live-cognito-probe\.sh/);
  assert.match(script, /DesiredCount=0 ActivationEnabled=false/);
  assert.match(script, /productionAppClientVerified/);
  assert.match(script, /OPENAI_API_KEY_SECRET_ARN/);
  assert.match(script, /secretsmanager describe-secret/);
  assert.doesNotMatch(script, /get-secret-value/);
});

test('ECR scan polling never appends a shell fallback brace to valid JSON', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-production-runtime.sh'), 'utf8');
  assert.match(script, /if \[\[ -z "\$scan_json" \]\]; then scan_json='\{\}'; fi/);
  assert.match(script, /<<<"\$scan_json"/);
  assert.doesNotMatch(script, /\$\{scan_json:-\{\}\}/);
});

test('ECR vulnerability failures report only bounded finding metadata before activation', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-production-runtime.sh'), 'utf8');
  assert.match(script, /ECR scan blocked activation: CRITICAL=\$critical HIGH=\$high/);
  assert.match(script, /package_name/);
  assert.match(script, /package_version/);
  assert.match(script, /select\(\.severity == "CRITICAL" or \.severity == "HIGH"\)/);
  assert.doesNotMatch(script, /\.description|\.uri/);
});

test('only the exact empty first-create rollback can be recovered', () => {
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-production-runtime.sh'), 'utf8');
  assert.match(script, /runtime_stack_status=.*describe-stacks/);
  assert.match(script, /runtime_stack_status" == "ROLLBACK_FAILED"/);
  assert.match(script, /recover_failed_initial_stack/);
  assert.match(script, /mfaConfiguration/);
  assert.match(script, /deletion protection is activated/);
  assert.match(script, /EstimatedNumberOfUsers/);
  assert.match(script, /list-users --user-pool-id/);
  assert.match(script, /length == 0/);
  assert.match(script, /LogicalResourceId == "Database"/);
  assert.match(script, /LogicalResourceId == "PrivateEvidenceBucket"/);
  assert.match(script, /update-user-pool.*--deletion-protection INACTIVE/);
  assert.match(script, /delete-stack.*--role-arn/);
  assert.match(script, /wait stack-delete-complete/);
  assert.doesNotMatch(script, /force-delete-without-recovery/);
  assert.doesNotMatch(script, /delete-log-group/);
  assert.doesNotMatch(script, /schedule-key-deletion/);
  assert.match(script, /describe-stack-events/);
  assert.match(script, /--max-items 200/);
  assert.match(script, /ResourceStatus==`CREATE_FAILED`/);
  assert.match(script, /ResourceStatus==`UPDATE_FAILED`/);
  assert.match(script, /ResourceStatus==`DELETE_FAILED`/);
  assert.match(script, /LogicalResourceId,ResourceType,ResourceStatus,ResourceStatusReason/);
  assert.match(script, /requires reviewed recovery before another change set/);
});

test('replacement stack preserves retained failed-create artifacts under distinct names', () => {
  const template = readFileSync(path.join(__dirname, '..', 'infrastructure', 'cloudformation', 'cbcap-agentic-runtime.yml'), 'utf8');
  assert.match(template, /Name: cbcap-agentic\/runtime-database-password-production/);
  assert.match(template, /LogGroupName: \/sozorock\/cbcap\/agentic-runtime-production/);
  assert.doesNotMatch(template, /Name: cbcap-agentic\/runtime-database-password(?:\n|$)/);
  assert.doesNotMatch(template, /LogGroupName: \/sozorock\/cbcap\/agentic-runtime(?:\n|$)/);
});

test('Cognito MFA enum remains a quoted string', () => {
  const template = readFileSync(path.join(__dirname, '..', 'infrastructure', 'cloudformation', 'cbcap-agentic-runtime.yml'), 'utf8');
  assert.match(template, /MfaConfiguration: 'ON'/);
  assert.doesNotMatch(template, /MfaConfiguration: ON(?:\n|$)/);
});

test('first-create rollback remains deletable until the stack is healthy', () => {
  const template = readFileSync(path.join(__dirname, '..', 'infrastructure', 'cloudformation', 'cbcap-agentic-runtime.yml'), 'utf8');
  const script = readFileSync(path.join(__dirname, '..', 'scripts', 'deploy-production-runtime.sh'), 'utf8');
  assert.match(template, /UserPoolDeletionProtection:/);
  assert.match(template, /AllowedValues: \[ACTIVE, INACTIVE\]/);
  assert.match(template, /DeletionProtection: !Ref UserPoolDeletionProtection/);
  assert.match(script, /DesiredCount=0 ActivationEnabled=false UserPoolDeletionProtection=INACTIVE/);
  assert.match(script, /DesiredCount=1 ActivationEnabled=false UserPoolDeletionProtection=ACTIVE/);
  assert.match(script, /DesiredCount=1 ActivationEnabled=true UserPoolDeletionProtection=ACTIVE/);
});

test('production workflow deploys only the exact triggering commit', () => {
  const workflow = readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'deploy-production-runtime.yml'), 'utf8');
  assert.match(workflow, /ref: \$\{\{ github\.sha \}\}/);
  assert.doesNotMatch(workflow, /ref: main/);
  assert.match(workflow, /RELEASE_SHA: \$\{\{ github\.sha \}\}/);
  assert.match(workflow, /test "\$approved_commit" = "\$RELEASE_SHA"/);
  assert.match(workflow, /test "\$origin_main" = "\$approved_commit"/);
  assert.match(workflow, /ACTIONS_ID_TOKEN_REQUEST_TOKEN/);
  assert.match(workflow, /repo:drolu-cmyk@271617784\/sozorock-health-agentic@1313269615:environment:production/);
  assert.match(workflow, /deploy-production-runtime\.yml@refs\/heads\/main/);
  assert.doesNotMatch(workflow, /echo .*oidc_token/);
  assert.match(workflow, /sozorock-health-contact/);
  assert.match(workflow, /Parameters\[\?ParameterKey=='OpenAISecretArn'\]/);
  assert.match(workflow, /secretsmanager describe-secret/);
  assert.doesNotMatch(workflow, /get-secret-value/);
  assert.match(workflow, /CB_CAP_AGENT_MODEL:-gpt-5\.6-sol/);
});

test('production image excludes the retired demonstration frontend', () => {
  const dockerfile = readFileSync(path.join(__dirname, '..', 'Dockerfile.runtime'), 'utf8');
  assert.match(dockerfile, /^FROM node:24\.19\.0-bookworm-slim@sha256:a9f5f7c91a432850b2a8a7797adf5eadb6c733ceed61167806cee7ea7fbc29df AS build$/m);
  assert.match(dockerfile, /^FROM gcr\.io\/distroless\/nodejs24-debian13:nonroot@sha256:4ac45c93b6c4b2304876569196e5962e55e8ba4ba095e7dde7bf6d7e00efc3b8$/m);
  assert.match(dockerfile, /COPY --from=build --chown=65532:65532/);
  assert.match(dockerfile, /USER 65532:65532/);
  assert.doesNotMatch(dockerfile, /^COPY frontend\b/m);
  assert.match(dockerfile, /CMD \["server\/production-index\.js"\]/);
  assert.match(dockerfile, /COPY package\.json package-lock\.json/);
  assert.match(dockerfile, /npm ci --omit=dev/);
  const runtime = dockerfile.slice(dockerfile.indexOf('\nFROM gcr.io/distroless'));
  assert.doesNotMatch(runtime, /apt-get|apk add|curl|perl/);
});

test('distroless task commands extend the Node entrypoint without a duplicate executable', () => {
  const template = readFileSync(path.join(__dirname, '..', 'infrastructure', 'cloudformation', 'cbcap-agentic-runtime.yml'), 'utf8');
  assert.match(template, /Command: \[scripts\/migrate-postgres\.js\]/);
  assert.match(template, /Command: \[scripts\/run-production-preflight\.js\]/);
  assert.doesNotMatch(template, /Command: \[node,/);
});

test('production template injects the exact OpenAI secret only through the ECS execution role', () => {
  const template = readFileSync(path.join(__dirname, '..', 'infrastructure', 'cloudformation', 'cbcap-agentic-runtime.yml'), 'utf8');
  assert.match(template, /OpenAIApiKeySecretArn:/);
  assert.match(template, /PolicyName: ReadRuntimeInjectedSecrets[\s\S]*!Ref OpenAIApiKeySecretArn/);
  assert.match(template, /Name: OPENAI_API_KEY[\s\S]*ValueFrom: !Ref OpenAIApiKeySecretArn/);
  const applicationRole = template.slice(template.indexOf('  RuntimeTaskRole:'), template.indexOf('  MigrationTaskExecutionRole:'));
  assert.doesNotMatch(applicationRole, /secretsmanager/);
  const migrationTask = template.slice(template.indexOf('  MigrationTaskDefinition:'), template.indexOf('  PreflightTaskDefinition:'));
  assert.doesNotMatch(migrationTask, /OPENAI_API_KEY/);
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

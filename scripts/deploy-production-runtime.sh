#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${EXPECTED_AWS_ACCOUNT_ID:?EXPECTED_AWS_ACCOUNT_ID is required}"
: "${CLOUDFORMATION_ROLE_ARN:?CLOUDFORMATION_ROLE_ARN is required}"
: "${APPROVED_COMMIT:?APPROVED_COMMIT is required}"
: "${OPENAI_API_KEY_SECRET_ARN:?OPENAI_API_KEY_SECRET_ARN is required}"
: "${CB_CAP_AGENT_MODEL:?CB_CAP_AGENT_MODEL is required}"
: "${CB_CAP_AGENT_PROMPT_VERSION:?CB_CAP_AGENT_PROMPT_VERSION is required}"

[[ "$OPENAI_API_KEY_SECRET_ARN" =~ ^arn:[A-Za-z0-9-]+:secretsmanager:[A-Za-z0-9-]+:[0-9]{12}:secret:[A-Za-z0-9/_+=.@-]+$ ]]
[[ "$CB_CAP_AGENT_MODEL" =~ ^[A-Za-z0-9][A-Za-z0-9._:-]{2,119}$ ]]
[[ "$CB_CAP_AGENT_PROMPT_VERSION" =~ ^[a-z0-9][a-z0-9._-]{5,119}$ ]]

REGISTRY_STACK="cbcap-agentic-registry"
RUNTIME_STACK="cbcap-agentic-production"
ECR_REPOSITORY="sozorock/cbcap-agentic-runtime"
API_DOMAIN="api.cbcap.sozorockfoundation.org"
PUBLIC_SITE="https://health.sozorockfoundation.org"
RUNTIME_TEMPLATE="infrastructure/cloudformation/cbcap-agentic-runtime.yml"
RESTORE_INSTANCE=""
RUNTIME_IMAGE_URI=""

mkdir -p output/production

stack_output() {
  local key="$1"
  aws cloudformation describe-stacks \
    --stack-name "$RUNTIME_STACK" \
    --query "Stacks[0].Outputs[?OutputKey=='$key'].OutputValue" \
    --output text
}

network_config() {
  jq -cn \
    --arg subnets "$PUBLIC_SUBNETS" \
    --arg sg "$RUNTIME_SECURITY_GROUP" \
    '{awsvpcConfiguration:{subnets:($subnets|split(",")),securityGroups:[$sg],assignPublicIp:"ENABLED"}}'
}

disable_runtime() {
  if [[ -z "$RUNTIME_IMAGE_URI" ]]; then return 0; fi
  if ! aws cloudformation describe-stacks --stack-name "$RUNTIME_STACK" >/dev/null 2>&1; then return 0; fi
  echo "Fail-closed rollback: disabling institutional ingress and runtime tasks."
  set +e
  aws cloudformation deploy \
    --stack-name "$RUNTIME_STACK" \
    --template-file "$RUNTIME_TEMPLATE" \
    --capabilities CAPABILITY_NAMED_IAM \
    --role-arn "$CLOUDFORMATION_ROLE_ARN" \
    --parameter-overrides RuntimeImageUri="$RUNTIME_IMAGE_URI" DesiredCount=0 ActivationEnabled=false OpenAIApiKeySecretArn="$OPENAI_API_KEY_SECRET_ARN" AgentModel="$CB_CAP_AGENT_MODEL" AgentPromptVersion="$CB_CAP_AGENT_PROMPT_VERSION" AgentKillSwitch=false \
    --no-fail-on-empty-changeset
  set -e
}

cleanup_restore() {
  if [[ -z "$RESTORE_INSTANCE" ]]; then return 0; fi
  if aws rds describe-db-instances --db-instance-identifier "$RESTORE_INSTANCE" >/dev/null 2>&1; then
    echo "Deleting temporary restore-proof instance $RESTORE_INSTANCE."
    set +e
    aws rds delete-db-instance --db-instance-identifier "$RESTORE_INSTANCE" --skip-final-snapshot --delete-automated-backups >/dev/null
    aws rds wait db-instance-deleted --db-instance-identifier "$RESTORE_INSTANCE"
    set -e
  fi
  RESTORE_INSTANCE=""
}

on_error() {
  local code=$?
  cleanup_restore
  disable_runtime
  exit "$code"
}
trap on_error ERR
trap cleanup_restore EXIT

account_id=$(aws sts get-caller-identity --query Account --output text)
test "$account_id" = "$EXPECTED_AWS_ACCOUNT_ID"
caller_arn=$(aws sts get-caller-identity --query Arn --output text)
case "$caller_arn" in
  arn:aws:sts::${EXPECTED_AWS_ACCOUNT_ID}:assumed-role/cbcap-agentic-github-deploy/*) ;;
  *) echo "Unexpected AWS deployment identity: $caller_arn"; exit 1 ;;
esac

origin_main=$(git ls-remote --exit-code origin refs/heads/main | awk '{print $1}')
test "$origin_main" = "$APPROVED_COMMIT"
test "$(git rev-parse HEAD)" = "$APPROVED_COMMIT"
test -z "$(git status --porcelain --untracked-files=no)"

aws cloudformation deploy \
  --stack-name "$REGISTRY_STACK" \
  --template-file infrastructure/cloudformation/cbcap-agentic-registry.yml \
  --role-arn "$CLOUDFORMATION_ROLE_ARN" \
  --no-fail-on-empty-changeset

repository_uri=$(aws cloudformation describe-stacks \
  --stack-name "$REGISTRY_STACK" \
  --query "Stacks[0].Outputs[?OutputKey=='RepositoryUri'].OutputValue" \
  --output text)
test -n "$repository_uri"
registry_host="${repository_uri%%/*}"
image_tag_uri="$repository_uri:$APPROVED_COMMIT"

if aws ecr describe-images --repository-name "$ECR_REPOSITORY" --image-ids imageTag="$APPROVED_COMMIT" >/tmp/cbcap-image.json 2>/tmp/cbcap-image.err; then
  echo "Reusing immutable runtime image for $APPROVED_COMMIT."
else
  if ! grep -q 'ImageNotFoundException' /tmp/cbcap-image.err; then cat /tmp/cbcap-image.err; exit 1; fi
  aws ecr get-login-password --region "$AWS_REGION" | docker login --username AWS --password-stdin "$registry_host"
  docker build --file Dockerfile.runtime --tag "$image_tag_uri" .
  docker push "$image_tag_uri"
fi

for attempt in $(seq 1 60); do
  scan_json=$(aws ecr describe-image-scan-findings \
    --repository-name "$ECR_REPOSITORY" \
    --image-id imageTag="$APPROVED_COMMIT" \
    --output json 2>/tmp/cbcap-scan.err || true)
  if [[ -z "$scan_json" ]]; then scan_json='{}'; fi
  scan_status=$(jq -r '.imageScanStatus.status // ""' <<<"$scan_json")
  case "$scan_status" in
    COMPLETE) break ;;
    FAILED|UNSUPPORTED_IMAGE|FINDINGS_UNAVAILABLE) echo "ECR scan failed with $scan_status"; exit 1 ;;
    *)
      if [[ "$attempt" -eq 1 ]]; then
        aws ecr start-image-scan --repository-name "$ECR_REPOSITORY" --image-id imageTag="$APPROVED_COMMIT" >/dev/null 2>&1 || true
      fi
      sleep 10
      ;;
  esac
  if [[ "$attempt" -eq 60 ]]; then echo "ECR vulnerability scan did not complete."; exit 1; fi
done

critical=$(jq -r '.imageScanFindings.findingSeverityCounts.CRITICAL // 0' <<<"$scan_json")
high=$(jq -r '.imageScanFindings.findingSeverityCounts.HIGH // 0' <<<"$scan_json")
test "$critical" = "0"
test "$high" = "0"
image_digest=$(aws ecr describe-images --repository-name "$ECR_REPOSITORY" --image-ids imageTag="$APPROVED_COMMIT" --query 'imageDetails[0].imageDigest' --output text)
[[ "$image_digest" =~ ^sha256:[0-9a-f]{64}$ ]]
RUNTIME_IMAGE_URI="$repository_uri@$image_digest"
repo_mutability=$(aws ecr describe-repositories --repository-names "$ECR_REPOSITORY" --query 'repositories[0].imageTagMutability' --output text)
test "$repo_mutability" = "IMMUTABLE"

aws cloudformation deploy \
  --stack-name "$RUNTIME_STACK" \
  --template-file "$RUNTIME_TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --role-arn "$CLOUDFORMATION_ROLE_ARN" \
  --parameter-overrides RuntimeImageUri="$RUNTIME_IMAGE_URI" DesiredCount=0 ActivationEnabled=false OpenAIApiKeySecretArn="$OPENAI_API_KEY_SECRET_ARN" AgentModel="$CB_CAP_AGENT_MODEL" AgentPromptVersion="$CB_CAP_AGENT_PROMPT_VERSION" AgentKillSwitch=false \
  --no-fail-on-empty-changeset

ECS_CLUSTER=$(stack_output ClusterName)
ECS_SERVICE=$(stack_output RuntimeServiceName)
MIGRATION_TASK=$(stack_output MigrationTaskDefinitionArn)
PREFLIGHT_TASK=$(stack_output PreflightTaskDefinitionArn)
RUNTIME_SECURITY_GROUP=$(stack_output RuntimeSecurityGroupId)
PUBLIC_SUBNETS=$(stack_output PublicSubnetIds)
DATABASE_ID=$(stack_output DatabaseIdentifier)
DATABASE_SECURITY_GROUP=$(stack_output DatabaseSecurityGroupId)
DATABASE_SUBNET_GROUP=$(stack_output DatabaseSubnetGroupName)
RUNTIME_PASSWORD_ARN=$(stack_output RuntimeDatabasePasswordArn)
USER_POOL_ID=$(stack_output UserPoolId)
USER_POOL_CLIENT_ID=$(stack_output UserPoolClientId)
COGNITO_ISSUER_URL=$(stack_output CognitoIssuerUrl)
COGNITO_HOSTED_UI_DOMAIN=$(stack_output CognitoHostedUiDomain)
COGNITO_OAUTH_CALLBACK_URL=$(stack_output CognitoOAuthCallbackUrl)
COGNITO_OAUTH_LOGOUT_URL=$(stack_output CognitoOAuthLogoutUrl)
PRIVATE_BUCKET=$(stack_output PrivateEvidenceBucketName)
PRIVATE_KMS_ARN=$(stack_output PrivateEvidenceKmsKeyArn)
LOG_GROUP=$(stack_output RuntimeLogGroupName)
INCIDENT_TOPIC=$(stack_output IncidentTopicArn)
ALARM_ARN=$(stack_output UnhealthyTargetAlarmArn)
CERTIFICATE_ARN=$(stack_output CertificateArn)
LOAD_BALANCER_ARN=$(stack_output LoadBalancerArn)
WEB_ACL_ARN=$(stack_output WebAclArn)
STACK_OPENAI_SECRET_ARN=$(stack_output OpenAIApiKeySecretArn)

for required in "$ECS_CLUSTER" "$ECS_SERVICE" "$MIGRATION_TASK" "$PREFLIGHT_TASK" "$RUNTIME_SECURITY_GROUP" "$PUBLIC_SUBNETS" "$DATABASE_ID" "$DATABASE_SECURITY_GROUP" "$DATABASE_SUBNET_GROUP" "$RUNTIME_PASSWORD_ARN" "$USER_POOL_ID" "$USER_POOL_CLIENT_ID" "$COGNITO_ISSUER_URL" "$COGNITO_HOSTED_UI_DOMAIN" "$COGNITO_OAUTH_CALLBACK_URL" "$COGNITO_OAUTH_LOGOUT_URL" "$PRIVATE_BUCKET" "$PRIVATE_KMS_ARN" "$LOG_GROUP" "$INCIDENT_TOPIC" "$ALARM_ARN" "$CERTIFICATE_ARN" "$LOAD_BALANCER_ARN" "$WEB_ACL_ARN" "$STACK_OPENAI_SECRET_ARN"; do
  test -n "$required"
done
test "$STACK_OPENAI_SECRET_ARN" = "$OPENAI_API_KEY_SECRET_ARN"
aws secretsmanager describe-secret --secret-id "$STACK_OPENAI_SECRET_ARN" >/dev/null

migration_task_arn=$(aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$MIGRATION_TASK" \
  --launch-type FARGATE \
  --network-configuration "$(network_config)" \
  --query 'tasks[0].taskArn' --output text)
test -n "$migration_task_arn"
test "$migration_task_arn" != "None"
aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$migration_task_arn"
migration_json=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$migration_task_arn" --output json)
migration_exit=$(jq -r '.tasks[0].containers[] | select(.name=="migration") | .exitCode // -1' <<<"$migration_json")
if [[ "$migration_exit" != "0" ]]; then
  jq '{task:.tasks[0]|{stopCode,stoppedReason,containers}}' <<<"$migration_json"
  exit 1
fi

aws cloudformation deploy \
  --stack-name "$RUNTIME_STACK" \
  --template-file "$RUNTIME_TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --role-arn "$CLOUDFORMATION_ROLE_ARN" \
  --parameter-overrides RuntimeImageUri="$RUNTIME_IMAGE_URI" DesiredCount=1 ActivationEnabled=false OpenAIApiKeySecretArn="$OPENAI_API_KEY_SECRET_ARN" AgentModel="$CB_CAP_AGENT_MODEL" AgentPromptVersion="$CB_CAP_AGENT_PROMPT_VERSION" AgentKillSwitch=false \
  --no-fail-on-empty-changeset
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"

service_json=$(aws ecs describe-services --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE" --output json)
test "$(jq -r '.services[0].desiredCount' <<<"$service_json")" = "1"
test "$(jq -r '.services[0].runningCount' <<<"$service_json")" = "1"

db_json=$(aws rds describe-db-instances --db-instance-identifier "$DATABASE_ID" --query 'DBInstances[0]' --output json)
test "$(jq -r '.PubliclyAccessible' <<<"$db_json")" = "false"
test "$(jq -r '.StorageEncrypted' <<<"$db_json")" = "true"
test "$(jq -r '.DBInstanceStatus' <<<"$db_json")" = "available"
jq -e --arg sg "$DATABASE_SECURITY_GROUP" 'any(.VpcSecurityGroups[]; .VpcSecurityGroupId==$sg)' <<<"$db_json" >/dev/null

sg_json=$(aws ec2 describe-security-groups --group-ids "$DATABASE_SECURITY_GROUP" --query 'SecurityGroups[0]' --output json)
jq -e --arg runtime "$RUNTIME_SECURITY_GROUP" '
  (.IpPermissions|length)==1 and
  .IpPermissions[0].IpProtocol=="tcp" and
  .IpPermissions[0].FromPort==5432 and
  .IpPermissions[0].ToPort==5432 and
  any(.IpPermissions[0].UserIdGroupPairs[]; .GroupId==$runtime)
' <<<"$sg_json" >/dev/null

aws secretsmanager describe-secret --secret-id "$RUNTIME_PASSWORD_ARN" >/dev/null

test "$(aws s3api get-bucket-versioning --bucket "$PRIVATE_BUCKET" --query Status --output text)" = "Enabled"
encryption_json=$(aws s3api get-bucket-encryption --bucket "$PRIVATE_BUCKET" --output json)
jq -e --arg kms "$PRIVATE_KMS_ARN" '
  any(.ServerSideEncryptionConfiguration.Rules[];
    .ApplyServerSideEncryptionByDefault.SSEAlgorithm=="aws:kms" and
    .ApplyServerSideEncryptionByDefault.KMSMasterKeyID==$kms)
' <<<"$encryption_json" >/dev/null
public_block=$(aws s3api get-public-access-block --bucket "$PRIVATE_BUCKET" --output json)
jq -e '.PublicAccessBlockConfiguration | .BlockPublicAcls and .IgnorePublicAcls and .BlockPublicPolicy and .RestrictPublicBuckets' <<<"$public_block" >/dev/null
lifecycle_json=$(aws s3api get-bucket-lifecycle-configuration --bucket "$PRIVATE_BUCKET" --output json)
jq -e '.Rules | length > 0' <<<"$lifecycle_json" >/dev/null

pool_json=$(aws cognito-idp describe-user-pool --user-pool-id "$USER_POOL_ID" --output json)
test "$(jq -r '.UserPool.MfaConfiguration' <<<"$pool_json")" = "ON"
for attr in tenant_id workspace_role workspace_access; do
  jq -e --arg attr "$attr" 'any(.UserPool.SchemaAttributes[]; .Name==$attr or .Name==("custom:"+$attr))' <<<"$pool_json" >/dev/null
done
client_json=$(aws cognito-idp describe-user-pool-client --user-pool-id "$USER_POOL_ID" --client-id "$USER_POOL_CLIENT_ID" --output json)
test "$(jq -r '.UserPoolClient.ClientId' <<<"$client_json")" = "$USER_POOL_CLIENT_ID"
test -z "$(jq -r '.UserPoolClient.ClientSecret // ""' <<<"$client_json")"
jq -e 'any(.UserPoolClient.ExplicitAuthFlows[]; .=="ALLOW_USER_SRP_AUTH")' <<<"$client_json" >/dev/null
test "$(jq -c '.UserPoolClient.AllowedOAuthFlows' <<<"$client_json")" = '["code"]'
jq -e '.UserPoolClient.AllowedOAuthFlowsUserPoolClient == true' <<<"$client_json" >/dev/null
jq -e '.UserPoolClient.AllowedOAuthScopes | sort == ["email","openid","profile"]' <<<"$client_json" >/dev/null
jq -e '.UserPoolClient.CallbackURLs == ["https://cbcap.sozorockfoundation.org/auth/callback"]' <<<"$client_json" >/dev/null
jq -e '.UserPoolClient.LogoutURLs == ["https://cbcap.sozorockfoundation.org/"]' <<<"$client_json" >/dev/null
jq -e 'any(.UserPoolClient.SupportedIdentityProviders[]; .=="COGNITO")' <<<"$client_json" >/dev/null
test "$COGNITO_OAUTH_CALLBACK_URL" = "https://cbcap.sozorockfoundation.org/auth/callback"
test "$COGNITO_OAUTH_LOGOUT_URL" = "https://cbcap.sozorockfoundation.org/"
hosted_ui_prefix="${COGNITO_HOSTED_UI_DOMAIN#https://}"
hosted_ui_prefix="${hosted_ui_prefix%%.auth.*}"
domain_json=$(aws cognito-idp describe-user-pool-domain --domain "$hosted_ui_prefix" --output json)
test "$(jq -r '.DomainDescription.UserPoolId // ""' <<<"$domain_json")" = "$USER_POOL_ID"
jq -cn \
  --arg apiOrigin "https://$API_DOMAIN" \
  --arg region "$AWS_REGION" \
  --arg userPoolId "$USER_POOL_ID" \
  --arg clientId "$USER_POOL_CLIENT_ID" \
  --arg issuer "$COGNITO_ISSUER_URL" \
  --arg hostedUiDomain "$COGNITO_HOSTED_UI_DOMAIN" \
  --arg callbackUrl "$COGNITO_OAUTH_CALLBACK_URL" \
  --arg logoutUrl "$COGNITO_OAUTH_LOGOUT_URL" \
  '{apiOrigin:$apiOrigin,awsRegion:$region,userPoolId:$userPoolId,userPoolClientId:$clientId,issuer:$issuer,hostedUiDomain:$hostedUiDomain,oauthFlow:"authorization_code_pkce",callbackUrl:$callbackUrl,logoutUrl:$logoutUrl}' \
  > output/production/ui-runtime-config.json
identity_policy=$(node scripts/identity-policy-probe.js)
jq -e '.ok and .sameTenantAuthorized and .humanReviewAuthorityVerified and .callerTenantOverrideIgnored and .agentCannotCreatePlan and .viewerCannotCreatePlan' <<<"$identity_policy" >/dev/null

aws logs describe-log-groups --log-group-name-prefix "$LOG_GROUP" --query "logGroups[?logGroupName=='$LOG_GROUP'] | [0].logGroupName" --output text | grep -Fx "$LOG_GROUP"
alarm_name="${ALARM_ARN##*:alarm:}"
alarm_json=$(aws cloudwatch describe-alarms --alarm-names "$alarm_name" --output json)
jq -e --arg topic "$INCIDENT_TOPIC" 'any(.MetricAlarms[0].AlarmActions[]; .==$topic)' <<<"$alarm_json" >/dev/null
aws sns get-topic-attributes --topic-arn "$INCIDENT_TOPIC" >/dev/null

test "$(aws acm describe-certificate --certificate-arn "$CERTIFICATE_ARN" --query 'Certificate.Status' --output text)" = "ISSUED"
associated_waf=$(aws wafv2 get-web-acl-for-resource --resource-arn "$LOAD_BALANCER_ARN" --query 'WebACL.ARN' --output text)
test "$associated_waf" = "$WEB_ACL_ARN"

snapshot_id="cbcap-agentic-proof-${APPROVED_COMMIT:0:12}-${GITHUB_RUN_ID:-manual}"
restore_id="cbcap-agentic-restore-${APPROVED_COMMIT:0:8}-${GITHUB_RUN_ID:-manual}"
RESTORE_INSTANCE="$restore_id"
aws rds create-db-snapshot --db-instance-identifier "$DATABASE_ID" --db-snapshot-identifier "$snapshot_id" >/dev/null
aws rds wait db-snapshot-available --db-snapshot-identifier "$snapshot_id"
aws rds restore-db-instance-from-db-snapshot \
  --db-instance-identifier "$restore_id" \
  --db-snapshot-identifier "$snapshot_id" \
  --db-subnet-group-name "$DATABASE_SUBNET_GROUP" \
  --vpc-security-group-ids "$DATABASE_SECURITY_GROUP" \
  --no-publicly-accessible \
  --no-deletion-protection \
  --tags Key=Product,Value=CB-CAP Key=Purpose,Value=restore-proof >/dev/null
aws rds wait db-instance-available --db-instance-identifier "$restore_id"
restore_json=$(aws rds describe-db-instances --db-instance-identifier "$restore_id" --query 'DBInstances[0]' --output json)
test "$(jq -r '.DBInstanceStatus' <<<"$restore_json")" = "available"
test "$(jq -r '.PubliclyAccessible' <<<"$restore_json")" = "false"
cleanup_restore

aws cloudformation deploy \
  --stack-name "$RUNTIME_STACK" \
  --template-file "$RUNTIME_TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --role-arn "$CLOUDFORMATION_ROLE_ARN" \
  --parameter-overrides RuntimeImageUri="$RUNTIME_IMAGE_URI" DesiredCount=1 ActivationEnabled=true OpenAIApiKeySecretArn="$OPENAI_API_KEY_SECRET_ARN" AgentModel="$CB_CAP_AGENT_MODEL" AgentPromptVersion="$CB_CAP_AGENT_PROMPT_VERSION" AgentKillSwitch=false \
  --no-fail-on-empty-changeset
aws ecs wait services-stable --cluster "$ECS_CLUSTER" --services "$ECS_SERVICE"

for attempt in $(seq 1 30); do
  if curl --proto '=https' --tlsv1.2 --fail --silent --show-error --dump-header /tmp/cbcap-live-headers.txt --output /tmp/cbcap-live-health.json "https://$API_DOMAIN/healthz"; then break; fi
  if [[ "$attempt" -eq 30 ]]; then echo "Live CB-CAP API did not become healthy."; exit 1; fi
  sleep 10
done
jq -e '.status=="ok"' /tmp/cbcap-live-health.json >/dev/null
grep -qi '^strict-transport-security: *max-age=31536000; includeSubDomains' /tmp/cbcap-live-headers.txt
grep -qi '^x-content-type-options: *nosniff' /tmp/cbcap-live-headers.txt
grep -qi '^x-frame-options: *DENY' /tmp/cbcap-live-headers.txt
grep -qi '^referrer-policy: *no-referrer' /tmp/cbcap-live-headers.txt
grep -qi '^permissions-policy: *camera=(), microphone=(), geolocation=()' /tmp/cbcap-live-headers.txt
grep -qi '^x-request-id:' /tmp/cbcap-live-headers.txt
grep -qi '^cache-control: *no-store' /tmp/cbcap-live-headers.txt
curl --proto '=https' --tlsv1.2 --fail --silent --show-error "https://$API_DOMAIN/readyz" | jq -e '.status=="ready"' >/dev/null

protected_status=$(curl --proto '=https' --tlsv1.2 --silent --output /tmp/cbcap-protected.json --write-out '%{http_code}' -X POST -H 'Content-Type: application/json' -d '{"location":"36001"}' "https://$API_DOMAIN/api/cbcap")
test "$protected_status" = "403"

allowed_status=$(curl --proto '=https' --tlsv1.2 --silent --output /dev/null --write-out '%{http_code}' -X OPTIONS -H 'Origin: https://cbcap.sozorockfoundation.org' -H 'Access-Control-Request-Method: POST' "https://$API_DOMAIN/api/cbcap")
test "$allowed_status" = "204"
disallowed_status=$(curl --proto '=https' --tlsv1.2 --silent --output /dev/null --write-out '%{http_code}' -X OPTIONS -H 'Origin: https://untrusted.example' -H 'Access-Control-Request-Method: POST' "https://$API_DOMAIN/api/cbcap")
test "$disallowed_status" = "403"
host_status=$(curl --proto '=https' --tlsv1.2 --silent --output /dev/null --write-out '%{http_code}' -H 'Host: untrusted.example' "https://$API_DOMAIN/api/health")
test "$host_status" = "503"

identity_live=$(USER_POOL_ID="$USER_POOL_ID" USER_POOL_CLIENT_ID="$USER_POOL_CLIENT_ID" API_DOMAIN="$API_DOMAIN" CB_CAP_AGENT_MODEL="$CB_CAP_AGENT_MODEL" CB_CAP_AGENT_PROMPT_VERSION="$CB_CAP_AGENT_PROMPT_VERSION" bash scripts/live-cognito-probe.sh)
jq -e '.claimsVerified and .sameTenantAuthorized and .crossTenantDenied and .humanReviewAuthorityVerified and .livePlanAndReviewVerified and .unauthorizedAgentDenied and .productionAppClientVerified and .agentStructuredOutputVerified and .agentSpecialistSequenceVerified and .agentCountyReleaseBound and .agentHumanReviewPreserved and .agentModelIdentityVerified and .agentPromptVersionVerified and (.agentResponseIdHash|test("^sha256:[0-9a-f]{64}$")) and (.agentOutputHash|test("^sha256:[0-9a-f]{64}$"))' <<<"$identity_live" >/dev/null

for attempt in $(seq 1 30); do
  audit_json=$(aws logs filter-log-events --log-group-name "$LOG_GROUP" --limit 100 --output json)
  if jq -e 'any(.events[]?; .message|contains("\"type\":\"cbcap_audit\""))' <<<"$audit_json" >/dev/null; then break; fi
  if [[ "$attempt" -eq 30 ]]; then echo "Structured audit event was not reachable in CloudWatch Logs."; exit 1; fi
  sleep 5
done

aws cloudformation deploy \
  --stack-name "$RUNTIME_STACK" \
  --template-file "$RUNTIME_TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --role-arn "$CLOUDFORMATION_ROLE_ARN" \
  --parameter-overrides RuntimeImageUri="$RUNTIME_IMAGE_URI" DesiredCount=1 ActivationEnabled=false OpenAIApiKeySecretArn="$OPENAI_API_KEY_SECRET_ARN" AgentModel="$CB_CAP_AGENT_MODEL" AgentPromptVersion="$CB_CAP_AGENT_PROMPT_VERSION" AgentKillSwitch=false \
  --no-fail-on-empty-changeset
rollback_api_status=$(curl --proto '=https' --tlsv1.2 --silent --output /dev/null --write-out '%{http_code}' "https://$API_DOMAIN/healthz")
test "$rollback_api_status" = "503"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --output /dev/null "$PUBLIC_SITE/explore"
curl --proto '=https' --tlsv1.2 --fail --silent --show-error --dump-header /tmp/gateway-rollback-headers.txt --output /tmp/gateway-rollback.json "$PUBLIC_SITE/api/evidence/v1/gateway?geoid=36001"
grep -qi '^x-evidence-contract: *sozorock.evidence-gateway.v1' /tmp/gateway-rollback-headers.txt
jq -e '.package.geographies[0].county_fips=="36001"' /tmp/gateway-rollback.json >/dev/null

aws cloudformation deploy \
  --stack-name "$RUNTIME_STACK" \
  --template-file "$RUNTIME_TEMPLATE" \
  --capabilities CAPABILITY_NAMED_IAM \
  --role-arn "$CLOUDFORMATION_ROLE_ARN" \
  --parameter-overrides RuntimeImageUri="$RUNTIME_IMAGE_URI" DesiredCount=1 ActivationEnabled=true OpenAIApiKeySecretArn="$OPENAI_API_KEY_SECRET_ARN" AgentModel="$CB_CAP_AGENT_MODEL" AgentPromptVersion="$CB_CAP_AGENT_PROMPT_VERSION" AgentKillSwitch=false \
  --no-fail-on-empty-changeset
for attempt in $(seq 1 30); do
  if curl --proto '=https' --tlsv1.2 --fail --silent --show-error "https://$API_DOMAIN/readyz" | jq -e '.status=="ready"' >/dev/null; then break; fi
  if [[ "$attempt" -eq 30 ]]; then echo "CB-CAP API did not recover after rollback proof."; exit 1; fi
  sleep 10
done

PROOF_JSON=$(jq -cn \
  --arg release "$APPROVED_COMMIT" \
  --arg image "$image_digest" \
  --argjson identity "$identity_live" \
  '{
    releaseSha:$release,
    imageDigest:$image,
    identity:$identity,
    deployment:{
      oidcIdentityVerified:true,
      deploymentAccountVerified:true,
      protectedMainShaVerified:true,
      immutableImageVerified:true,
      vulnerabilityScanClean:true,
      managedSecretsVerified:true,
      privateEvidenceStorageVerified:true,
      databaseNetworkIsolationVerified:true,
      migrationsCompletedBeforeTraffic:true,
      runtimeEnabledAfterMigrations:true,
      tlsCertificateVerified:true,
      edgeProtectionVerified:true,
      securityHeadersVerified:true,
      corsBoundaryVerified:true,
      unauthenticatedProtectedRouteDenied:true,
      cognitoPkceHostedUiVerified:true
    },
    model:{
      structuredOutputVerified:$identity.agentStructuredOutputVerified,
      specialistSequenceVerified:$identity.agentSpecialistSequenceVerified,
      countyReleaseBound:$identity.agentCountyReleaseBound,
      humanReviewPreserved:$identity.agentHumanReviewPreserved,
      modelIdentityVerified:$identity.agentModelIdentityVerified,
      promptVersionVerified:$identity.agentPromptVersionVerified,
      outputHashRecorded:($identity.agentOutputHash|test("^sha256:[0-9a-f]{64}$")),
      responseIdHashRecorded:($identity.agentResponseIdHash|test("^sha256:[0-9a-f]{64}$")),
      modelId:$identity.agentModelId,
      promptVersion:$identity.agentPromptVersion,
      outputHash:$identity.agentOutputHash,
      responseIdHash:$identity.agentResponseIdHash
    },
    recovery:{backupVerified:true,restoreVerified:true},
    observability:{logsReachable:true,auditEventsReachable:true,alertsConfigured:true,incidentRouteConfigured:true},
    rollback:{institutionalDisableVerified:true,publicExploreUnaffected:true,evidenceGatewayUnaffected:true}
  }')
printf '%s\n' "$PROOF_JSON" > output/production/live-proof.json

preflight_overrides=$(jq -cn --arg proof "$PROOF_JSON" '{containerOverrides:[{name:"preflight",environment:[{name:"CB_CAP_LIVE_PROOF_JSON",value:$proof}]}]}')
preflight_task_arn=$(aws ecs run-task \
  --cluster "$ECS_CLUSTER" \
  --task-definition "$PREFLIGHT_TASK" \
  --launch-type FARGATE \
  --network-configuration "$(network_config)" \
  --overrides "$preflight_overrides" \
  --query 'tasks[0].taskArn' --output text)
test -n "$preflight_task_arn"
test "$preflight_task_arn" != "None"
aws ecs wait tasks-stopped --cluster "$ECS_CLUSTER" --tasks "$preflight_task_arn"
preflight_json=$(aws ecs describe-tasks --cluster "$ECS_CLUSTER" --tasks "$preflight_task_arn" --output json)
preflight_exit=$(jq -r '.tasks[0].containers[] | select(.name=="preflight") | .exitCode // -1' <<<"$preflight_json")
if [[ "$preflight_exit" != "0" ]]; then
  jq '{task:.tasks[0]|{stopCode,stoppedReason,containers}}' <<<"$preflight_json"
  exit 1
fi

origin_main_after=$(git ls-remote --exit-code origin refs/heads/main | awk '{print $1}')
test "$origin_main_after" = "$APPROVED_COMMIT"

trap - ERR
printf 'CB-CAP production activation verified for %s with image %s\n' "$APPROVED_COMMIT" "$image_digest"

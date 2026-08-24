#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${USER_POOL_ID:?USER_POOL_ID is required}"
: "${USER_POOL_CLIENT_ID:?USER_POOL_CLIENT_ID is required}"
: "${API_DOMAIN:?API_DOMAIN is required}"

probe_id="${GITHUB_RUN_ID:-$(date +%s)}"
planner_user="cbcap-preflight-planner-${probe_id}@example.invalid"
agent_user="cbcap-preflight-agent-${probe_id}@example.invalid"
other_planner_user="cbcap-preflight-other-${probe_id}@example.invalid"
planner_password="Aa9!$(openssl rand -hex 18)"
agent_password="Aa9!$(openssl rand -hex 18)"
other_planner_password="Aa9!$(openssl rand -hex 18)"

cleanup() {
  set +e
  aws cognito-idp admin-delete-user --user-pool-id "$USER_POOL_ID" --username "$planner_user" >/dev/null 2>&1 || true
  aws cognito-idp admin-delete-user --user-pool-id "$USER_POOL_ID" --username "$agent_user" >/dev/null 2>&1 || true
  aws cognito-idp admin-delete-user --user-pool-id "$USER_POOL_ID" --username "$other_planner_user" >/dev/null 2>&1 || true
}
trap cleanup EXIT

create_user() {
  local username="$1"
  local password="$2"
  local tenant="$3"
  local role="$4"
  local access="$5"
  local attrs
  attrs=$(jq -cn \
    --arg email "$username" \
    --arg tenant "$tenant" \
    --arg role "$role" \
    --arg access "$access" \
    '[
      {Name:"email",Value:$email},
      {Name:"email_verified",Value:"true"},
      {Name:"custom:tenant_id",Value:$tenant},
      {Name:"custom:workspace_role",Value:$role},
      {Name:"custom:workspace_access",Value:$access}
    ]')
  aws cognito-idp admin-create-user \
    --user-pool-id "$USER_POOL_ID" \
    --username "$username" \
    --message-action SUPPRESS \
    --user-attributes "$attrs" >/dev/null
  aws cognito-idp admin-set-user-password \
    --user-pool-id "$USER_POOL_ID" \
    --username "$username" \
    --password "$password" \
    --permanent >/dev/null
}

create_user "$planner_user" "$planner_password" "cbcap-preflight-tenant-a" county_planner owner
create_user "$agent_user" "$agent_password" "cbcap-preflight-tenant-a" evidence_agent viewer
create_user "$other_planner_user" "$other_planner_password" "cbcap-preflight-tenant-b" county_planner owner

authenticate_with_production_client() {
  local username="$1"
  local password="$2"
  node scripts/cognito-srp-auth.js \
    "$USER_POOL_ID" \
    "$USER_POOL_CLIENT_ID" \
    "$username" \
    "$password"
}

planner_token=$(authenticate_with_production_client "$planner_user" "$planner_password")
agent_token=$(authenticate_with_production_client "$agent_user" "$agent_password")
other_planner_token=$(authenticate_with_production_client "$other_planner_user" "$other_planner_password")

planner_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-planner-plan.json --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $planner_token" \
  --data '{"location":"36001"}' \
  "https://$API_DOMAIN/api/cbcap")
test "$planner_status" = "202"
run_id=$(jq -r '.runId // ""' /tmp/cbcap-planner-plan.json)
test -n "$run_id"
test "$(jq -r '.status // ""' /tmp/cbcap-planner-plan.json)" = "awaiting_human_review"

agent_plan_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-agent-plan.json --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $agent_token" \
  --data '{"location":"36001"}' \
  "https://$API_DOMAIN/api/cbcap")
test "$agent_plan_status" = "403"

agent_review_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-agent-review.json --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $agent_token" \
  --data '{"decision":"approve"}' \
  "https://$API_DOMAIN/api/cbcap/runs/$run_id/review")
test "$agent_review_status" = "403"

cross_tenant_review_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-cross-tenant-review.json --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $other_planner_token" \
  --data '{"decision":"approve"}' \
  "https://$API_DOMAIN/api/cbcap/runs/$run_id/review")
case "$cross_tenant_review_status" in
  403|404) ;;
  *)
    echo "Cross-tenant planner unexpectedly received HTTP $cross_tenant_review_status."
    exit 1
    ;;
esac

planner_review_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-planner-review.json --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $planner_token" \
  --data '{"decision":"approve"}' \
  "https://$API_DOMAIN/api/cbcap/runs/$run_id/review")
test "$planner_review_status" = "200"
test "$(jq -r '.status // ""' /tmp/cbcap-planner-review.json)" = "approved_output"
test "$(jq -r '.runId // ""' /tmp/cbcap-planner-review.json)" = "$run_id"

jq -cn \
  --arg runId "$run_id" \
  --arg crossTenantStatus "$cross_tenant_review_status" \
  --arg clientId "$USER_POOL_CLIENT_ID" \
  '{
    claimsVerified:true,
    sameTenantAuthorized:true,
    crossTenantDenied:true,
    humanReviewAuthorityVerified:true,
    livePlanAndReviewVerified:true,
    unauthorizedAgentDenied:true,
    productionAppClientVerified:true,
    crossTenantReviewStatus:$crossTenantStatus,
    appClientId:$clientId,
    runId:$runId
  }'

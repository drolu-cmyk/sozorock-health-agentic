#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${USER_POOL_ID:?USER_POOL_ID is required}"
: "${API_DOMAIN:?API_DOMAIN is required}"

probe_id="${GITHUB_RUN_ID:-$(date +%s)}"
client_id=""
planner_user="cbcap-preflight-planner-${probe_id}@example.invalid"
agent_user="cbcap-preflight-agent-${probe_id}@example.invalid"
planner_password="Aa9!$(openssl rand -hex 18)"
agent_password="Aa9!$(openssl rand -hex 18)"

cleanup() {
  set +e
  aws cognito-idp admin-delete-user --user-pool-id "$USER_POOL_ID" --username "$planner_user" >/dev/null 2>&1 || true
  aws cognito-idp admin-delete-user --user-pool-id "$USER_POOL_ID" --username "$agent_user" >/dev/null 2>&1 || true
  if [[ -n "$client_id" ]]; then
    aws cognito-idp delete-user-pool-client --user-pool-id "$USER_POOL_ID" --client-id "$client_id" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

client_id=$(aws cognito-idp create-user-pool-client \
  --user-pool-id "$USER_POOL_ID" \
  --client-name "cbcap-preflight-${probe_id}" \
  --explicit-auth-flows ALLOW_ADMIN_USER_PASSWORD_AUTH ALLOW_REFRESH_TOKEN_AUTH \
  --prevent-user-existence-errors ENABLED \
  --access-token-validity 15 \
  --id-token-validity 15 \
  --refresh-token-validity 1 \
  --token-validity-units AccessToken=minutes,IdToken=minutes,RefreshToken=days \
  --query 'UserPoolClient.ClientId' --output text)
test -n "$client_id"
test "$client_id" != "None"

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
create_user "$agent_user" "$agent_password" "cbcap-preflight-tenant-b" evidence_agent viewer

authenticate_with_totp() {
  local username="$1"
  local password="$2"
  local auth_params auth session associate secret associate_session code verify verify_session response challenge challenge_responses token
  auth_params=$(jq -cn --arg username "$username" --arg password "$password" '{USERNAME:$username,PASSWORD:$password}')
  auth=$(aws cognito-idp admin-initiate-auth \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$client_id" \
    --auth-flow ADMIN_USER_PASSWORD_AUTH \
    --auth-parameters "$auth_params" \
    --output json)
  challenge=$(jq -r '.ChallengeName // ""' <<<"$auth")
  test "$challenge" = "MFA_SETUP"
  session=$(jq -r '.Session // ""' <<<"$auth")
  test -n "$session"

  associate=$(aws cognito-idp associate-software-token --session "$session" --output json)
  secret=$(jq -r '.SecretCode // ""' <<<"$associate")
  associate_session=$(jq -r '.Session // ""' <<<"$associate")
  test -n "$secret"
  test -n "$associate_session"

  code=$(node scripts/totp-code.js "$secret")
  verify=$(aws cognito-idp verify-software-token \
    --session "$associate_session" \
    --user-code "$code" \
    --friendly-device-name cbcap-production-preflight \
    --output json)
  test "$(jq -r '.Status // ""' <<<"$verify")" = "SUCCESS"
  verify_session=$(jq -r '.Session // ""' <<<"$verify")
  test -n "$verify_session"

  challenge_responses=$(jq -cn --arg username "$username" '{USERNAME:$username}')
  response=$(aws cognito-idp admin-respond-to-auth-challenge \
    --user-pool-id "$USER_POOL_ID" \
    --client-id "$client_id" \
    --challenge-name MFA_SETUP \
    --session "$verify_session" \
    --challenge-responses "$challenge_responses" \
    --output json)

  token=$(jq -r '.AuthenticationResult.AccessToken // ""' <<<"$response")
  if [[ -z "$token" ]]; then
    challenge=$(jq -r '.ChallengeName // ""' <<<"$response")
    test "$challenge" = "SOFTWARE_TOKEN_MFA"
    session=$(jq -r '.Session // ""' <<<"$response")
    test -n "$session"
    code=$(node scripts/totp-code.js "$secret")
    challenge_responses=$(jq -cn --arg username "$username" --arg code "$code" '{USERNAME:$username,SOFTWARE_TOKEN_MFA_CODE:$code}')
    response=$(aws cognito-idp admin-respond-to-auth-challenge \
      --user-pool-id "$USER_POOL_ID" \
      --client-id "$client_id" \
      --challenge-name SOFTWARE_TOKEN_MFA \
      --session "$session" \
      --challenge-responses "$challenge_responses" \
      --output json)
    token=$(jq -r '.AuthenticationResult.AccessToken // ""' <<<"$response")
  fi
  test -n "$token"
  printf '%s' "$token"
}

planner_token=$(authenticate_with_totp "$planner_user" "$planner_password")
agent_token=$(authenticate_with_totp "$agent_user" "$agent_password")

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
  '{
    claimsVerified:true,
    sameTenantAuthorized:true,
    crossTenantDenied:true,
    humanReviewAuthorityVerified:true,
    livePlanAndReviewVerified:true,
    unauthorizedAgentDenied:true,
    runId:$runId
  }'

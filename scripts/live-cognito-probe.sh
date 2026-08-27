#!/usr/bin/env bash
set -euo pipefail

: "${AWS_REGION:?AWS_REGION is required}"
: "${USER_POOL_ID:?USER_POOL_ID is required}"
: "${USER_POOL_CLIENT_ID:?USER_POOL_CLIENT_ID is required}"
: "${API_DOMAIN:?API_DOMAIN is required}"
: "${CB_CAP_AGENT_MODEL:?CB_CAP_AGENT_MODEL is required}"
: "${CB_CAP_AGENT_PROMPT_VERSION:?CB_CAP_AGENT_PROMPT_VERSION is required}"

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

legacy_root_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-legacy-root.txt --write-out '%{http_code}' \
  "https://$API_DOMAIN/")
test "$legacy_root_status" = "404"

legacy_place_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-legacy-place.json --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --data '{"location":"36001"}' \
  "https://$API_DOMAIN/api/place")
test "$legacy_place_status" = "404"

legacy_health_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-legacy-health.json --write-out '%{http_code}' \
  "https://$API_DOMAIN/api/health")
test "$legacy_health_status" = "200"
test "$(jq -r '.status // ""' /tmp/cbcap-legacy-health.json)" = "ok"
test "$(jq -r '.institutionalAccessEnabled // false' /tmp/cbcap-legacy-health.json)" = "true"

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
test "$(jq -r '.draft.agentAssistance.status // ""' /tmp/cbcap-planner-plan.json)" = "completed_requires_human_review"
test "$(jq -r '.draft.agentAssistance.contract // ""' /tmp/cbcap-planner-plan.json)" = "cbcap.agent-run.v1"
test "$(jq -r '.draft.agentAssistance.synthesis.kind // ""' /tmp/cbcap-planner-plan.json)" = "cbcap.agent-evidence-synthesis.v1"
test "$(jq -r '.draft.agentAssistance.brief.kind // ""' /tmp/cbcap-planner-plan.json)" = "cbcap.agent-planning-brief.v1"
test "$(jq -r '.draft.agentAssistance.model // ""' /tmp/cbcap-planner-plan.json)" = "$CB_CAP_AGENT_MODEL"
test "$(jq -r '.draft.agentAssistance.promptVersion // ""' /tmp/cbcap-planner-plan.json)" = "$CB_CAP_AGENT_PROMPT_VERSION"
jq -e '.draft.agentAssistance.trace.toolCalls == ["synthesize_governed_evidence","draft_reviewable_planning_brief"]' /tmp/cbcap-planner-plan.json >/dev/null
jq -e '.draft.agentAssistance.trace.responseIdHash | test("^sha256:[0-9a-f]{64}$")' /tmp/cbcap-planner-plan.json >/dev/null
jq -e '.draft.agentAssistance.synthesis.countyFips == .evidence.countyFips and .draft.agentAssistance.brief.countyFips == .evidence.countyFips and .draft.agentAssistance.synthesis.releaseId == .evidence.releaseId and .draft.agentAssistance.brief.releaseId == .evidence.releaseId' /tmp/cbcap-planner-plan.json >/dev/null
agent_response_id_hash=$(jq -r '.draft.agentAssistance.trace.responseIdHash' /tmp/cbcap-planner-plan.json)
agent_output_hash="sha256:$(jq -cS '.draft.agentAssistance | {contract,promptVersion,model,synthesis,brief,trace:{toolCalls,lastAgent,responseIdHash}}' /tmp/cbcap-planner-plan.json | sha256sum | awk '{print $1}')"

visualization_workspace_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-visualization-workspace.json --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $planner_token" \
  --data '{"question":"compare_places","countyFips":["36001","36093","36057","42029","48029"],"sourceMeasureIds":["LACKTRPT:Crude"],"selectedCountyFips":"36001"}' \
  "https://$API_DOMAIN/api/cbcap/visualizations/workspace")
test "$visualization_workspace_status" = "200"
test "$(jq -r '.contract // ""' /tmp/cbcap-visualization-workspace.json)" = "cbcap.visualization-workspace.v1"
test "$(jq -r '.releaseId // ""' /tmp/cbcap-visualization-workspace.json)" != ""
test "$(jq -r '.countyFips | length' /tmp/cbcap-visualization-workspace.json)" = "5"
test "$(jq -r '.data | length' /tmp/cbcap-visualization-workspace.json)" = "5"
test "$(jq -r '.renderPackage.contract // ""' /tmp/cbcap-visualization-workspace.json)" = "cbcap.visualization-render-package.v1"
test "$(jq -r '.renderPackage.claimId // ""' /tmp/cbcap-visualization-workspace.json)" = "$(jq -r '.claimId // ""' /tmp/cbcap-visualization-workspace.json)"
test "$(jq -r '.renderPackage.staticAndInteractiveClaimMatch // false' /tmp/cbcap-visualization-workspace.json)" = "true"
test "$(jq -r '.compositeScore == null' /tmp/cbcap-visualization-workspace.json)" = "true"
test "$(jq -r '.causalInference // true' /tmp/cbcap-visualization-workspace.json)" = "false"
visualization_workspace_release=$(jq -r '.releaseId' /tmp/cbcap-visualization-workspace.json)
visualization_workspace_claim=$(jq -r '.claimId' /tmp/cbcap-visualization-workspace.json)

missing_upload_id="preflight-missing-${probe_id}"
private_evidence_payload=$(jq -cn \
  --arg uploadId "$missing_upload_id" \
  --arg runId "$run_id" \
  '{
    uploadId:$uploadId,
    geographyIds:["county:36001"],
    submittedInRunId:$runId,
    documentType:"preflight_probe",
    sourceLabel:"Production private evidence composition probe",
    sensitivity:"internal",
    rightsBasis:"organization_owned",
    usageRightsConfirmed:true,
    aggregationLevel:"organizational",
    containsPhi:false,
    containsIndividualHealthRecords:false,
    containsCredentialsOrSecrets:false,
    retentionUntil:"2099-12-31"
  }')
private_evidence_status=$(curl --proto '=https' --tlsv1.2 --silent --show-error \
  --output /tmp/cbcap-private-evidence-probe.json --write-out '%{http_code}' \
  --request POST \
  --header 'Content-Type: application/json' \
  --header "Authorization: Bearer $planner_token" \
  --data "$private_evidence_payload" \
  "https://$API_DOMAIN/api/cbcap/private-evidence/submissions")
test "$private_evidence_status" = "404"
test "$(jq -r '.error // ""' /tmp/cbcap-private-evidence-probe.json)" = "Tenant-private evidence upload was not found."

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
  --arg visualizationRelease "$visualization_workspace_release" \
  --arg visualizationClaim "$visualization_workspace_claim" \
  --arg agentModel "$CB_CAP_AGENT_MODEL" \
  --arg agentPromptVersion "$CB_CAP_AGENT_PROMPT_VERSION" \
  --arg agentResponseIdHash "$agent_response_id_hash" \
  --arg agentOutputHash "$agent_output_hash" \
  '{
    claimsVerified:true,
    sameTenantAuthorized:true,
    crossTenantDenied:true,
    humanReviewAuthorityVerified:true,
    livePlanAndReviewVerified:true,
    unauthorizedAgentDenied:true,
    productionAppClientVerified:true,
    privateEvidenceMetadataLookupVerified:true,
    institutionalApiBoundaryVerified:true,
    legacyFrontendDenied:true,
    legacyPlaceApiDenied:true,
    apiHealthForwarded:true,
    visualizationWorkspaceVerified:true,
    visualizationWorkspaceFiveCountyEvidenceVerified:true,
    visualizationWorkspaceRenderClaimVerified:true,
    agentStructuredOutputVerified:true,
    agentSpecialistSequenceVerified:true,
    agentCountyReleaseBound:true,
    agentHumanReviewPreserved:true,
    agentModelIdentityVerified:true,
    agentPromptVersionVerified:true,
    agentResponseIdHash:$agentResponseIdHash,
    agentOutputHash:$agentOutputHash,
    agentModelId:$agentModel,
    agentPromptVersion:$agentPromptVersion,
    visualizationRelease:$visualizationRelease,
    visualizationClaim:$visualizationClaim,
    crossTenantReviewStatus:$crossTenantStatus,
    appClientId:$clientId,
    runId:$runId
  }'

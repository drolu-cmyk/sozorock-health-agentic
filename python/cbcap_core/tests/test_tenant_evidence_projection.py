from datetime import date, datetime, timedelta, timezone

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus
from cbcap_core.tenant_evidence import (
    TenantEvidenceReview,
    TenantEvidenceSubmissionRequest,
    TenantStoredObject,
    assess_tenant_evidence_submission,
    tenant_evidence_partition,
)
from cbcap_core.tenant_evidence_projection import (
    authorize_tenant_evidence_for_run,
    build_tenant_evidence_overlay,
)

TENANT = "tenant:albany-planning"
COUNTY = "county:36001"
OLD_RUN = "run:2025-cycle"
CURRENT_RUN = "run:2027-cycle"
NOW = datetime(2027, 1, 15, 12, 0, tzinfo=timezone.utc)


def actor(*, tenant_id=TENANT, geography_ids=None, run_ids=None):
    grant = AuthorizationGrant(
        grant_id="grant:2027-planning",
        actor_id="principal:planner",
        tenant_id=tenant_id,
        capabilities=sorted(ROLE_CAPABILITIES["planner"]),
        geography_ids=geography_ids if geography_ids is not None else [COUNTY],
        run_ids=run_ids if run_ids is not None else [CURRENT_RUN],
        issuer="test-identity-verifier",
        issued_at=datetime(2026, 12, 1, tzinfo=timezone.utc),
        expires_at=datetime(2028, 1, 1, tzinfo=timezone.utc),
    )
    return AuthorizedActor(
        actor_id="principal:planner",
        tenant_id=tenant_id,
        role="planner",
        authorization=grant,
    )


def county_run(*, county_id=COUNTY, tenant_id=TENANT):
    fips = county_id.split(":", 1)[1]
    return CountyRunState(
        run_id=CURRENT_RUN,
        tenant_id=tenant_id,
        county=GeographyRef(
            id=county_id,
            kind=GeographyKind.COUNTY,
            authority="census",
            authority_id=fips,
            name="Test County",
            display_name="Test County",
            state_fips=fips[:2],
            county_fips=fips,
            vintage="2025",
            review_status=ReviewStatus.VERIFIED,
        ),
        requested_at=NOW,
    )


def old_cycle_document(*, geography_ids=None, retention_until=date(2030, 1, 1)):
    partition = tenant_evidence_partition(TENANT)
    request = TenantEvidenceSubmissionRequest(
        geography_ids=geography_ids or [COUNTY],
        submitted_in_run_id=OLD_RUN,
        stored_object=TenantStoredObject(
            bucket="sozorock-cbcap-private-evidence",
            key=f"tenant-evidence/{partition}/2025/program-plan.pdf",
            version_id="version-2025",
            content_hash="sha256:" + "c" * 64,
            byte_length=2048,
            media_type="application/pdf",
            encryption_mode="aws:kms",
            kms_key_arn="arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
            public_access_blocked=True,
        ),
        document_type="internal_program_plan",
        source_label="2025 internal implementation plan",
        sensitivity="confidential",
        rights_basis="organization_owned",
        usage_rights_confirmed=True,
        aggregation_level="program_aggregate",
        retention_until=retention_until,
    )
    # Submission was authorized in an older cycle. For this fixture, use a
    # grant that includes that historical run only at submission time.
    submitter_grant = AuthorizationGrant(
        grant_id="grant:2025-submit",
        actor_id="principal:submitter",
        tenant_id=TENANT,
        capabilities=["read_workspace", "record_workspace_proposal"],
        geography_ids=request.geography_ids,
        run_ids=[OLD_RUN],
        issuer="test-identity-verifier",
        issued_at=datetime(2025, 1, 1, tzinfo=timezone.utc),
        expires_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
    )
    submitter = AuthorizedActor(
        actor_id="principal:submitter",
        tenant_id=TENANT,
        role="analyst",
        authorization=submitter_grant,
    )
    return assess_tenant_evidence_submission(request, actor=submitter)


def review(document, decision, when, suffix):
    return TenantEvidenceReview(
        id=f"review:{suffix}",
        document_id=document.id,
        tenant_id=TENANT,
        decision=decision,
        reason_codes=[f"decision:{decision}"],
        rationale="Controlled review history.",
        reviewed_by="principal:reviewer",
        reviewed_at=when,
    )


def test_accepted_old_cycle_document_can_support_new_cycle_without_historical_run_grant():
    document = old_cycle_document()
    accepted = review(document, "accepted", datetime(2025, 6, 1, tzinfo=timezone.utc), "accepted")
    current_actor = actor(run_ids=[CURRENT_RUN])

    decision = authorize_tenant_evidence_for_run(
        county_run(),
        document,
        [accepted],
        actor=current_actor,
        as_of=NOW,
    )
    assert decision.status == "ready"
    assert decision.current_run_id == CURRENT_RUN
    assert document.submitted_in_run_id == OLD_RUN


def test_current_run_scope_is_required_even_when_document_was_previously_accepted():
    document = old_cycle_document()
    accepted = review(document, "accepted", datetime(2025, 6, 1, tzinfo=timezone.utc), "accepted")
    with pytest.raises(PermissionError, match="county run"):
        authorize_tenant_evidence_for_run(
            county_run(),
            document,
            [accepted],
            actor=actor(run_ids=["run:other"]),
            as_of=NOW,
        )


def test_document_must_apply_to_current_county():
    document = old_cycle_document(geography_ids=["county:42029"])
    accepted = review(document, "accepted", datetime(2025, 6, 1, tzinfo=timezone.utc), "accepted")
    decision = authorize_tenant_evidence_for_run(
        county_run(),
        document,
        [accepted],
        actor=actor(),
        as_of=NOW,
    )
    assert decision.status == "blocked"
    assert decision.reason_codes == ["document_not_applicable_to_current_geography"]


def test_latest_review_and_retention_still_control_cross_cycle_use():
    document = old_cycle_document(retention_until=date(2026, 12, 31))
    accepted = review(document, "accepted", datetime(2025, 6, 1, tzinfo=timezone.utc), "accepted")
    rejected = review(document, "rejected", datetime(2026, 10, 1, tzinfo=timezone.utc), "rejected")
    decision = authorize_tenant_evidence_for_run(
        county_run(),
        document,
        [accepted, rejected],
        actor=actor(),
        as_of=NOW,
    )
    assert decision.status == "blocked"
    assert "latest_review:rejected" in decision.reason_codes
    assert "retention_expired" in decision.reason_codes


def test_overlay_contains_safe_metadata_not_storage_location_or_raw_content():
    document = old_cycle_document()
    accepted = review(document, "accepted", datetime(2025, 6, 1, tzinfo=timezone.utc), "accepted")
    overlay = build_tenant_evidence_overlay(
        county_run(),
        [document],
        [accepted],
        actor=actor(),
        as_of=NOW,
    )
    assert len(overlay.documents) == 1
    projected = overlay.documents[0].model_dump(mode="json")
    assert projected["content_hash"] == document.stored_object.content_hash
    for forbidden in ("bucket", "storage_bucket", "key", "storage_key", "kms_key_arn", "version_id"):
        assert forbidden not in projected
    relationships = {edge.relationship for edge in overlay.edges}
    assert relationships == {
        "document_applies_to_geography",
        "document_accepted_by_review",
        "document_originated_in_run",
        "document_available_to_current_run",
    }


def test_blocked_documents_are_not_projected_as_graph_nodes():
    document = old_cycle_document()
    rejected = review(document, "rejected", NOW - timedelta(days=1), "rejected")
    overlay = build_tenant_evidence_overlay(
        county_run(),
        [document],
        [rejected],
        actor=actor(),
        as_of=NOW,
    )
    assert overlay.documents == []
    assert overlay.edges == []
    assert overlay.blocked_document_ids == [document.id]


def test_cross_tenant_overlay_fails_closed():
    document = old_cycle_document()
    accepted = review(document, "accepted", datetime(2025, 6, 1, tzinfo=timezone.utc), "accepted")
    with pytest.raises(ValueError, match="tenant"):
        build_tenant_evidence_overlay(
            county_run(),
            [document],
            [accepted],
            actor=actor(tenant_id="tenant:other"),
            as_of=NOW,
        )

from datetime import date, datetime, timedelta, timezone

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.tenant_evidence import (
    TenantEvidenceReview,
    TenantEvidenceSubmissionRequest,
    TenantStoredObject,
    assess_tenant_evidence_submission,
    tenant_evidence_partition,
)
from cbcap_core.tenant_evidence_use import authorize_tenant_evidence_use

TENANT = "tenant:albany-planning"
COUNTY = "county:36001"
RUN = "run:tenant-evidence:36001"
NOW = datetime(2026, 8, 22, 12, 0, tzinfo=timezone.utc)


def actor(*, tenant_id=TENANT, geography_ids=None, run_ids=None):
    grant = AuthorizationGrant(
        grant_id="grant:reader",
        actor_id="principal:reader",
        tenant_id=tenant_id,
        capabilities=sorted(ROLE_CAPABILITIES["reviewer"]),
        geography_ids=geography_ids if geography_ids is not None else [COUNTY],
        run_ids=run_ids if run_ids is not None else [RUN],
        issuer="test-identity-verifier",
        issued_at=datetime(2026, 1, 1, tzinfo=timezone.utc),
        expires_at=datetime(2099, 1, 1, tzinfo=timezone.utc),
    )
    return AuthorizedActor(
        actor_id="principal:reader",
        tenant_id=tenant_id,
        role="reviewer",
        authorization=grant,
    )


def document(*, retention_until=date(2030, 1, 1), admission_updates=None):
    partition = tenant_evidence_partition(TENANT)
    request = TenantEvidenceSubmissionRequest(
        geography_ids=[COUNTY],
        submitted_in_run_id=RUN,
        stored_object=TenantStoredObject(
            bucket="sozorock-cbcap-private-evidence",
            key=f"tenant-evidence/{partition}/document.pdf",
            version_id="version-1",
            content_hash="sha256:" + "b" * 64,
            byte_length=100,
            media_type="application/pdf",
            encryption_mode="aws:kms",
            kms_key_arn="arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
            public_access_blocked=True,
        ),
        document_type="internal_program_plan",
        source_label="Internal plan",
        sensitivity="confidential",
        rights_basis="organization_owned",
        usage_rights_confirmed=True,
        aggregation_level="program_aggregate",
        retention_until=retention_until,
        **(admission_updates or {}),
    )
    return assess_tenant_evidence_submission(request, actor=actor())


def review(doc, decision, when, suffix):
    return TenantEvidenceReview(
        id=f"review:{suffix}",
        document_id=doc.id,
        tenant_id=TENANT,
        decision=decision,
        reason_codes=[f"decision:{decision}"],
        rationale="Controlled review history.",
        reviewed_by="principal:reviewer",
        reviewed_at=when,
    )


def test_unreviewed_document_cannot_enter_private_graph_or_workspace():
    doc = document()
    decision = authorize_tenant_evidence_use(doc, [], actor=actor(), as_of=NOW)
    assert decision.status == "blocked"
    assert decision.reason_codes == ["human_review_missing"]


def test_latest_acceptance_authorizes_private_use_only_with_actor_scope():
    doc = document()
    accepted = review(doc, "accepted", NOW - timedelta(days=1), "accepted")
    decision = authorize_tenant_evidence_use(doc, [accepted], actor=actor(), as_of=NOW)
    assert decision.status == "ready"
    assert decision.latest_review_id == accepted.id

    with pytest.raises(PermissionError, match="geography"):
        authorize_tenant_evidence_use(
            doc,
            [accepted],
            actor=actor(geography_ids=["county:42029"]),
            as_of=NOW,
        )

    with pytest.raises(PermissionError, match="county run"):
        authorize_tenant_evidence_use(
            doc,
            [accepted],
            actor=actor(run_ids=["run:other"]),
            as_of=NOW,
        )


def test_later_rejection_overrides_older_acceptance_without_mutating_history():
    doc = document()
    accepted = review(doc, "accepted", NOW - timedelta(days=3), "accepted")
    rejected = review(doc, "rejected", NOW - timedelta(days=1), "rejected")
    decision = authorize_tenant_evidence_use(
        doc,
        [rejected, accepted],
        actor=actor(),
        as_of=NOW,
    )
    assert decision.status == "blocked"
    assert decision.latest_review_id == rejected.id
    assert decision.reason_codes == ["latest_review:rejected"]


def test_needs_revision_after_acceptance_blocks_use_until_new_review():
    doc = document()
    accepted = review(doc, "accepted", NOW - timedelta(days=3), "accepted")
    revision = review(doc, "needs_revision", NOW - timedelta(days=1), "revision")
    decision = authorize_tenant_evidence_use(
        doc,
        [accepted, revision],
        actor=actor(),
        as_of=NOW,
    )
    assert decision.status == "blocked"
    assert "latest_review:needs_revision" in decision.reason_codes


def test_retention_expiry_blocks_use_even_when_human_review_is_accepted():
    doc = document(retention_until=date(2026, 8, 1))
    accepted = review(doc, "accepted", NOW - timedelta(days=2), "accepted")
    decision = authorize_tenant_evidence_use(doc, [accepted], actor=actor(), as_of=NOW)
    assert decision.status == "blocked"
    assert "retention_expired" in decision.reason_codes


def test_rejected_admission_remains_blocked_even_if_a_review_record_claims_acceptance():
    doc = document(admission_updates={"contains_phi": True})
    forged_acceptance = review(doc, "accepted", NOW - timedelta(days=1), "accepted")
    decision = authorize_tenant_evidence_use(
        doc,
        [forged_acceptance],
        actor=actor(),
        as_of=NOW,
    )
    assert decision.status == "blocked"
    assert "admission:rejected" in decision.reason_codes


def test_cross_tenant_use_fails_before_any_evidence_is_returned():
    doc = document()
    accepted = review(doc, "accepted", NOW - timedelta(days=1), "accepted")
    with pytest.raises(ValueError, match="tenant"):
        authorize_tenant_evidence_use(
            doc,
            [accepted],
            actor=actor(tenant_id="tenant:other"),
            as_of=NOW,
        )

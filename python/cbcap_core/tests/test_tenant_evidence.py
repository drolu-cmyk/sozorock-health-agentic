from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.tenant_evidence import (
    TenantEvidenceReviewRequest,
    TenantEvidenceSubmissionRequest,
    TenantStoredObject,
    assess_tenant_evidence_submission,
    persist_tenant_evidence_document,
    persist_tenant_evidence_review,
    review_tenant_evidence,
    tenant_evidence_partition,
)

TENANT = "tenant:albany-planning"
COUNTY = "county:36001"
RUN = "run:tenant-evidence:36001"
ISSUED = datetime(2026, 1, 1, tzinfo=timezone.utc)
EXPIRES = datetime(2099, 1, 1, tzinfo=timezone.utc)


def actor(*, role="analyst", tenant_id=TENANT, capabilities=None, geography_ids=None, run_ids=None):
    principal = f"principal:{role}"
    grant = AuthorizationGrant(
        grant_id=f"grant:{principal}",
        actor_id=principal,
        tenant_id=tenant_id,
        capabilities=capabilities or sorted(ROLE_CAPABILITIES[role]),
        geography_ids=geography_ids if geography_ids is not None else [COUNTY],
        run_ids=run_ids if run_ids is not None else [RUN],
        issuer="test-identity-verifier",
        issued_at=ISSUED,
        expires_at=EXPIRES,
    )
    return AuthorizedActor(
        actor_id=principal,
        tenant_id=tenant_id,
        role=role,
        authorization=grant,
    )


def stored_object(*, tenant_id=TENANT, media_type="application/pdf", key=None):
    partition = tenant_evidence_partition(tenant_id)
    return TenantStoredObject(
        bucket="sozorock-cbcap-private-evidence",
        key=key or f"tenant-evidence/{partition}/2026/document.pdf",
        version_id="3LgPrivateVersion",
        content_hash="sha256:" + "a" * 64,
        byte_length=1024,
        media_type=media_type,
        encryption_mode="aws:kms",
        kms_key_arn="arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
        public_access_blocked=True,
    )


def submission(**updates):
    payload = {
        "geography_ids": [COUNTY],
        "submitted_in_run_id": RUN,
        "stored_object": stored_object(),
        "document_type": "internal_program_plan",
        "source_label": "County partner program plan",
        "sensitivity": "confidential",
        "rights_basis": "organization_owned",
        "usage_rights_confirmed": True,
        "aggregation_level": "program_aggregate",
        "contains_phi": False,
        "contains_individual_health_records": False,
        "contains_credentials_or_secrets": False,
        "retention_until": date(2030, 12, 31),
    }
    payload.update(updates)
    return TenantEvidenceSubmissionRequest(**payload)


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        self.connection.executions.append((" ".join(query.split()), params))


class FakeConnection:
    def __init__(self):
        self.executions = []

    def cursor(self):
        return FakeCursor(self)


def test_private_object_requires_versioned_kms_storage_and_public_access_block():
    with pytest.raises(ValidationError):
        TenantStoredObject(
            bucket="sozorock-cbcap-private-evidence",
            key="tenant-evidence/safe/document.pdf",
            version_id="version",
            content_hash="sha256:" + "a" * 64,
            byte_length=10,
            media_type="application/pdf",
            encryption_mode="AES256",
            kms_key_arn="arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
            public_access_blocked=True,
        )

    with pytest.raises(ValidationError):
        TenantStoredObject(
            bucket="sozorock-cbcap-private-evidence",
            key="tenant-evidence/safe/document.pdf",
            version_id="version",
            content_hash="sha256:" + "a" * 64,
            byte_length=10,
            media_type="application/pdf",
            encryption_mode="aws:kms",
            kms_key_arn="arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
            public_access_blocked=False,
        )


def test_storage_key_must_match_authenticated_tenant_partition():
    wrong_key = f"tenant-evidence/{tenant_evidence_partition('tenant:other')}/document.pdf"
    with pytest.raises(ValueError, match="tenant partition"):
        assess_tenant_evidence_submission(
            submission(stored_object=stored_object(key=wrong_key)),
            actor=actor(),
        )


def test_submission_requires_explicit_workspace_proposal_county_and_run_scope():
    with pytest.raises(PermissionError, match="record_workspace_proposal"):
        assess_tenant_evidence_submission(
            submission(),
            actor=actor(
                capabilities=["read_workspace", "execute_county_run"],
            ),
        )

    with pytest.raises(PermissionError, match="geography"):
        assess_tenant_evidence_submission(
            submission(),
            actor=actor(geography_ids=["county:42029"]),
        )

    with pytest.raises(PermissionError, match="county run"):
        assess_tenant_evidence_submission(
            submission(),
            actor=actor(run_ids=["run:other"]),
        )


def test_aggregate_rights_confirmed_document_is_eligible_for_human_review():
    document = assess_tenant_evidence_submission(submission(), actor=actor())
    assert document.tenant_id == TENANT
    assert document.submitted_by == "principal:analyst"
    assert document.admission_state == "eligible_for_review"
    assert document.reason_codes == []


def test_private_evidence_rejects_phi_person_level_health_records_and_secrets():
    scenarios = [
        ({"contains_phi": True}, "phi_prohibited"),
        ({"contains_individual_health_records": True}, "individual_health_records_prohibited"),
        ({"contains_credentials_or_secrets": True}, "credentials_or_secrets_prohibited"),
        ({"aggregation_level": "person_level"}, "person_level_data_prohibited"),
        ({"usage_rights_confirmed": False}, "usage_rights_not_confirmed"),
    ]
    for updates, reason in scenarios:
        document = assess_tenant_evidence_submission(submission(**updates), actor=actor())
        assert document.admission_state == "rejected"
        assert reason in document.reason_codes


def test_unknown_media_is_quarantined_not_silently_accepted():
    document = assess_tenant_evidence_submission(
        submission(stored_object=stored_object(media_type="application/octet-stream")),
        actor=actor(),
    )
    assert document.admission_state == "quarantined"
    assert document.reason_codes == ["unsupported_media_type"]


def test_only_review_capability_can_accept_and_cross_tenant_review_fails_closed():
    document = assess_tenant_evidence_submission(submission(), actor=actor())
    review_request = TenantEvidenceReviewRequest(
        document=document,
        decision="accepted",
        reason_codes=["source_and_rights_reviewed"],
        rationale="The aggregate organization document is appropriate for this private workspace.",
    )

    with pytest.raises(PermissionError, match="record_workspace_review"):
        review_tenant_evidence(review_request, actor=actor(role="analyst"))

    with pytest.raises(ValueError, match="tenant"):
        review_tenant_evidence(
            review_request,
            actor=actor(role="reviewer", tenant_id="tenant:other"),
        )

    accepted = review_tenant_evidence(review_request, actor=actor(role="reviewer"))
    assert accepted.decision == "accepted"
    assert accepted.reviewed_by == "principal:reviewer"
    assert accepted.tenant_id == TENANT


def test_rejected_or_quarantined_document_cannot_be_accepted():
    rejected = assess_tenant_evidence_submission(
        submission(contains_phi=True),
        actor=actor(),
    )
    quarantined = assess_tenant_evidence_submission(
        submission(stored_object=stored_object(media_type="application/octet-stream")),
        actor=actor(),
    )
    for document in (rejected, quarantined):
        with pytest.raises(ValueError, match="only eligible"):
            review_tenant_evidence(
                TenantEvidenceReviewRequest(
                    document=document,
                    decision="accepted",
                    reason_codes=["attempted_acceptance"],
                    rationale="Should not be accepted.",
                ),
                actor=actor(role="reviewer"),
            )


def test_tenant_evidence_persistence_sets_rls_scope_and_is_insert_only():
    document = assess_tenant_evidence_submission(submission(), actor=actor())
    review = review_tenant_evidence(
        TenantEvidenceReviewRequest(
            document=document,
            decision="accepted",
            reason_codes=["reviewed"],
            rationale="Accepted for tenant-private planning use.",
        ),
        actor=actor(role="reviewer"),
    )

    document_connection = FakeConnection()
    review_connection = FakeConnection()
    persist_tenant_evidence_document(
        document_connection,
        document,
        actor_tenant_id=TENANT,
    )
    persist_tenant_evidence_review(
        review_connection,
        review,
        actor_tenant_id=TENANT,
    )

    assert document_connection.executions[0][1] == (TENANT,)
    assert "INSERT INTO cbcap.tenant_evidence_document" in document_connection.executions[1][0]
    assert "DO UPDATE" not in document_connection.executions[1][0].upper()
    assert review_connection.executions[0][1] == (TENANT,)
    assert "INSERT INTO cbcap.tenant_evidence_review" in review_connection.executions[1][0]
    assert "DO UPDATE" not in review_connection.executions[1][0].upper()

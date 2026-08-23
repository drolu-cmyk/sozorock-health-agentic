from datetime import date, datetime, timezone

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.models import (
    CountyRunState,
    GeographyKind,
    GeographyRef,
    Organization,
    ReviewStatus,
)
from cbcap_core.tenant_evidence import (
    TenantEvidenceDocument,
    TenantEvidenceReview,
    TenantStoredObject,
    tenant_evidence_partition,
)
from cbcap_core.tenant_evidence_linkage import (
    TenantEvidenceLinkIntent,
    build_tenant_evidence_planning_context,
)

TENANT = "tenant:albany-planning"
COUNTY = "county:36001"
CURRENT_RUN = "run:2027-cycle"
OLD_RUN = "run:2025-cycle"
NOW = datetime(2027, 1, 15, 12, 0, tzinfo=timezone.utc)
ORG = "organization:county-health"


def actor(*, role="planner", tenant_id=TENANT):
    return AuthorizedActor(
        actor_id=f"principal:{role}",
        tenant_id=tenant_id,
        role=role,
        authorization=AuthorizationGrant(
            grant_id=f"grant:{role}",
            actor_id=f"principal:{role}",
            tenant_id=tenant_id,
            capabilities=sorted(ROLE_CAPABILITIES[role]),
            geography_ids=[COUNTY],
            run_ids=[CURRENT_RUN],
            issuer="test-identity-verifier",
            issued_at=datetime(2027, 1, 1, tzinfo=timezone.utc),
            expires_at=datetime(2028, 1, 1, tzinfo=timezone.utc),
        ),
    )


def run(*, tenant_id=TENANT):
    return CountyRunState(
        run_id=CURRENT_RUN,
        tenant_id=tenant_id,
        county=GeographyRef(
            id=COUNTY,
            kind=GeographyKind.COUNTY,
            authority="census",
            authority_id="36001",
            name="Albany County",
            display_name="Albany County, New York",
            state_fips="36",
            county_fips="36001",
            vintage="2025",
            review_status=ReviewStatus.VERIFIED,
        ),
        requested_at=NOW,
        organizations=[
            Organization(
                id=ORG,
                name="County Health Department",
                organization_type="local_health_department",
                geography_ids=[COUNTY],
            )
        ],
    )


def document(*, tenant_id=TENANT):
    partition = tenant_evidence_partition(tenant_id)
    return TenantEvidenceDocument(
        id="tenant-evidence:document:1",
        tenant_id=tenant_id,
        geography_ids=[COUNTY],
        submitted_in_run_id=OLD_RUN,
        stored_object=TenantStoredObject(
            bucket="sozorock-cbcap-private-evidence",
            key=f"tenant-evidence/{partition}/2025/program-plan.pdf",
            version_id="version-2025",
            content_hash="sha256:" + "d" * 64,
            byte_length=2048,
            media_type="application/pdf",
            encryption_mode="aws:kms",
            kms_key_arn="arn:aws:kms:us-east-1:123456789012:key/11111111-2222-3333-4444-555555555555",
            public_access_blocked=True,
        ),
        document_type="internal_program_plan",
        source_label="Internal implementation plan",
        sensitivity="confidential",
        rights_basis="organization_owned",
        usage_rights_confirmed=True,
        aggregation_level="program_aggregate",
        contains_phi=False,
        contains_individual_health_records=False,
        contains_credentials_or_secrets=False,
        admission_state="eligible_for_review",
        reason_codes=[],
        submitted_by="principal:analyst",
        submitted_at=datetime(2025, 6, 1, tzinfo=timezone.utc),
        retention_until=date(2030, 1, 1),
    )


def review(doc, *, decision="accepted"):
    return TenantEvidenceReview(
        id=f"tenant-evidence-review:{decision}:1",
        document_id=doc.id,
        tenant_id=doc.tenant_id,
        decision=decision,
        reason_codes=[f"decision:{decision}"],
        rationale="Controlled review history.",
        reviewed_by="principal:reviewer",
        reviewed_at=datetime(2026, 12, 1, tzinfo=timezone.utc),
    )


def intent(*, document_id="tenant-evidence:document:1", target_entity_id=ORG):
    return TenantEvidenceLinkIntent(
        document_id=document_id,
        target_type="organization",
        target_entity_id=target_entity_id,
        rationale="The reviewed internal implementation plan documents this organization role.",
    )


def test_accepted_old_cycle_private_evidence_links_to_current_proprietary_planning_state():
    doc = document()
    context = build_tenant_evidence_planning_context(
        run(),
        [doc],
        [review(doc)],
        [intent()],
        actor=actor(),
        as_of=NOW,
    )
    assert context.tenant_id == TENANT
    assert context.run_id == CURRENT_RUN
    assert context.overlay.documents[0].submitted_in_run_id == OLD_RUN
    assert len(context.links) == 1
    link = context.links[0]
    assert link.document_id == doc.id
    assert link.target_entity_id == ORG
    assert link.status == "provisional"
    assert link.authoritative is False
    assert link.visibility == "tenant"


def test_link_serialization_cannot_leak_private_storage_location_or_kms_metadata():
    doc = document()
    context = build_tenant_evidence_planning_context(
        run(),
        [doc],
        [review(doc)],
        [intent()],
        actor=actor(),
        as_of=NOW,
    )
    payload = context.model_dump(mode="json")
    serialized = str(payload)
    for forbidden in (
        doc.stored_object.bucket,
        doc.stored_object.key,
        doc.stored_object.version_id,
        doc.stored_object.kms_key_arn,
    ):
        assert forbidden not in serialized
    assert doc.stored_object.content_hash in serialized


def test_rejected_document_cannot_be_linked_even_if_intent_references_it():
    doc = document()
    with pytest.raises(ValueError, match="not authorized in the current overlay"):
        build_tenant_evidence_planning_context(
            run(),
            [doc],
            [review(doc, decision="rejected")],
            [intent()],
            actor=actor(),
            as_of=NOW,
        )


def test_link_target_must_exist_in_canonical_planning_state():
    doc = document()
    with pytest.raises(ValueError, match="target is not present"):
        build_tenant_evidence_planning_context(
            run(),
            [doc],
            [review(doc)],
            [intent(target_entity_id="organization:missing")],
            actor=actor(),
            as_of=NOW,
        )


def test_cross_tenant_and_insufficient_capability_fail_closed():
    doc = document()
    with pytest.raises(ValueError, match="tenant"):
        build_tenant_evidence_planning_context(
            run(),
            [doc],
            [review(doc)],
            [intent()],
            actor=actor(tenant_id="tenant:other"),
            as_of=NOW,
        )

    with pytest.raises(PermissionError, match="record_workspace_proposal"):
        build_tenant_evidence_planning_context(
            run(),
            [doc],
            [review(doc)],
            [intent()],
            actor=actor(role="read_only"),
            as_of=NOW,
        )


def test_duplicate_link_intents_are_rejected_instead_of_silently_collapsing():
    doc = document()
    with pytest.raises(ValueError, match="duplicate"):
        build_tenant_evidence_planning_context(
            run(),
            [doc],
            [review(doc)],
            [intent(), intent()],
            actor=actor(),
            as_of=NOW,
        )

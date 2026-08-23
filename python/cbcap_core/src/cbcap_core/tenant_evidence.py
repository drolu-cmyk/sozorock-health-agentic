from __future__ import annotations

import hashlib
import json
from datetime import date, datetime, timezone
from typing import Literal

from pydantic import Field, model_validator

from .authorization import AuthorizedActor, require_actor_capability
from .models import StrictModel
from .persistence import ConnectionLike

TenantEvidenceSensitivity = Literal["internal", "confidential", "restricted"]
TenantEvidenceRightsBasis = Literal[
    "organization_owned",
    "partner_authorized",
    "licensed_for_use",
]
TenantEvidenceAggregationLevel = Literal[
    "organizational",
    "community_aggregate",
    "program_aggregate",
    "person_level",
]
TenantEvidenceAdmissionState = Literal[
    "eligible_for_review",
    "quarantined",
    "rejected",
]
TenantEvidenceReviewDecision = Literal["accepted", "rejected", "needs_revision"]

_ALLOWED_MEDIA_TYPES = frozenset(
    {
        "application/pdf",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "text/csv",
        "text/plain",
    }
)


def tenant_evidence_partition(tenant_id: str) -> str:
    """Opaque S3 partition so raw tenant IDs are not used as path syntax."""

    return hashlib.sha256(tenant_id.encode("utf-8")).hexdigest()[:32]


class TenantStoredObject(StrictModel):
    bucket: str = Field(pattern=r"^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$")
    key: str = Field(min_length=1)
    version_id: str = Field(min_length=1)
    content_hash: str = Field(pattern=r"^sha256:[0-9a-fA-F]{64}$")
    byte_length: int = Field(gt=0)
    media_type: str = Field(min_length=1)
    encryption_mode: Literal["aws:kms"] = "aws:kms"
    kms_key_arn: str = Field(pattern=r"^arn:aws:kms:[a-z0-9-]+:[0-9]{12}:key/[A-Za-z0-9-]+$")
    public_access_blocked: Literal[True] = True

    @model_validator(mode="after")
    def validate_key(self) -> "TenantStoredObject":
        if self.key.startswith("/"):
            raise ValueError("tenant evidence storage key must be relative")
        segments = self.key.split("/")
        if any(segment in {"", ".", ".."} for segment in segments):
            raise ValueError("tenant evidence storage key contains an unsafe path segment")
        return self


class TenantEvidenceSubmissionRequest(StrictModel):
    geography_ids: list[str] = Field(min_length=1)
    submitted_in_run_id: str = Field(min_length=1)
    stored_object: TenantStoredObject
    document_type: str = Field(min_length=1)
    source_label: str = Field(min_length=1)
    sensitivity: TenantEvidenceSensitivity
    rights_basis: TenantEvidenceRightsBasis
    usage_rights_confirmed: bool
    aggregation_level: TenantEvidenceAggregationLevel
    contains_phi: bool = False
    contains_individual_health_records: bool = False
    contains_credentials_or_secrets: bool = False
    retention_until: date | None = None

    @model_validator(mode="after")
    def validate_geographies(self) -> "TenantEvidenceSubmissionRequest":
        if len(set(self.geography_ids)) != len(self.geography_ids):
            raise ValueError("tenant evidence geography IDs must be unique")
        if any(not item.strip() for item in self.geography_ids):
            raise ValueError("tenant evidence geography IDs cannot be blank")
        return self


class TenantEvidenceDocument(StrictModel):
    id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    geography_ids: list[str] = Field(min_length=1)
    submitted_in_run_id: str = Field(min_length=1)
    stored_object: TenantStoredObject
    document_type: str = Field(min_length=1)
    source_label: str = Field(min_length=1)
    sensitivity: TenantEvidenceSensitivity
    rights_basis: TenantEvidenceRightsBasis
    usage_rights_confirmed: bool
    aggregation_level: TenantEvidenceAggregationLevel
    contains_phi: bool
    contains_individual_health_records: bool
    contains_credentials_or_secrets: bool
    admission_state: TenantEvidenceAdmissionState
    reason_codes: list[str] = Field(default_factory=list)
    submitted_by: str = Field(min_length=1)
    submitted_at: datetime
    retention_until: date | None = None


class TenantEvidenceReviewRequest(StrictModel):
    document: TenantEvidenceDocument
    decision: TenantEvidenceReviewDecision
    reason_codes: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)


class TenantEvidenceReview(StrictModel):
    id: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    decision: TenantEvidenceReviewDecision
    reason_codes: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)
    reviewed_by: str = Field(min_length=1)
    reviewed_at: datetime


def _submission_id(
    tenant_id: str,
    request: TenantEvidenceSubmissionRequest,
) -> str:
    identity = {
        "tenant_id": tenant_id,
        "geography_ids": sorted(request.geography_ids),
        "run_id": request.submitted_in_run_id,
        "bucket": request.stored_object.bucket,
        "key": request.stored_object.key,
        "version_id": request.stored_object.version_id,
        "content_hash": request.stored_object.content_hash,
    }
    digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"tenant-evidence:sha256:{digest}"


def _review_id(
    document: TenantEvidenceDocument,
    actor: AuthorizedActor,
    request: TenantEvidenceReviewRequest,
    reviewed_at: datetime,
) -> str:
    identity = {
        "document_id": document.id,
        "tenant_id": document.tenant_id,
        "decision": request.decision,
        "reason_codes": sorted(set(request.reason_codes)),
        "reviewed_by": actor.actor_id,
        "reviewed_at": reviewed_at.isoformat(),
    }
    digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"tenant-evidence-review:sha256:{digest}"


def _require_document_scope(
    actor: AuthorizedActor,
    *,
    capability: Literal["record_workspace_proposal", "record_workspace_review"],
    geography_ids: list[str],
    run_id: str,
) -> None:
    for geography_id in geography_ids:
        require_actor_capability(
            actor,
            capability,
            geography_id=geography_id,
            run_id=run_id,
        )


def assess_tenant_evidence_submission(
    request: TenantEvidenceSubmissionRequest,
    *,
    actor: AuthorizedActor,
) -> TenantEvidenceDocument:
    """Assess one already-stored private object without exposing it to public evidence paths."""

    if actor.tenant_id is None:
        raise ValueError("tenant-private evidence requires authenticated tenant identity")
    _require_document_scope(
        actor,
        capability="record_workspace_proposal",
        geography_ids=request.geography_ids,
        run_id=request.submitted_in_run_id,
    )

    partition = tenant_evidence_partition(actor.tenant_id)
    expected_prefix = f"tenant-evidence/{partition}/"
    if not request.stored_object.key.startswith(expected_prefix):
        raise ValueError("tenant evidence object key does not match authenticated tenant partition")

    submitted_at = datetime.now(timezone.utc)
    reasons: list[str] = []
    state: TenantEvidenceAdmissionState = "eligible_for_review"

    if request.stored_object.media_type not in _ALLOWED_MEDIA_TYPES:
        state = "quarantined"
        reasons.append("unsupported_media_type")
    if not request.usage_rights_confirmed:
        state = "rejected"
        reasons.append("usage_rights_not_confirmed")
    if request.aggregation_level == "person_level":
        state = "rejected"
        reasons.append("person_level_data_prohibited")
    if request.contains_phi:
        state = "rejected"
        reasons.append("phi_prohibited")
    if request.contains_individual_health_records:
        state = "rejected"
        reasons.append("individual_health_records_prohibited")
    if request.contains_credentials_or_secrets:
        state = "rejected"
        reasons.append("credentials_or_secrets_prohibited")
    if request.retention_until is not None and request.retention_until < submitted_at.date():
        state = "rejected"
        reasons.append("retention_expired")

    return TenantEvidenceDocument(
        id=_submission_id(actor.tenant_id, request),
        tenant_id=actor.tenant_id,
        geography_ids=request.geography_ids,
        submitted_in_run_id=request.submitted_in_run_id,
        stored_object=request.stored_object,
        document_type=request.document_type,
        source_label=request.source_label,
        sensitivity=request.sensitivity,
        rights_basis=request.rights_basis,
        usage_rights_confirmed=request.usage_rights_confirmed,
        aggregation_level=request.aggregation_level,
        contains_phi=request.contains_phi,
        contains_individual_health_records=request.contains_individual_health_records,
        contains_credentials_or_secrets=request.contains_credentials_or_secrets,
        admission_state=state,
        reason_codes=sorted(set(reasons)),
        submitted_by=actor.actor_id,
        submitted_at=submitted_at,
        retention_until=request.retention_until,
    )


def review_tenant_evidence(
    request: TenantEvidenceReviewRequest,
    *,
    actor: AuthorizedActor,
) -> TenantEvidenceReview:
    document = request.document
    if actor.tenant_id != document.tenant_id:
        raise ValueError("tenant evidence review tenant does not match authenticated actor tenant")
    _require_document_scope(
        actor,
        capability="record_workspace_review",
        geography_ids=document.geography_ids,
        run_id=document.submitted_in_run_id,
    )

    reviewed_at = datetime.now(timezone.utc)
    if request.decision == "accepted" and document.admission_state != "eligible_for_review":
        raise ValueError("only eligible tenant evidence can be accepted")
    if (
        request.decision == "accepted"
        and document.retention_until is not None
        and document.retention_until < reviewed_at.date()
    ):
        raise ValueError("expired tenant evidence cannot be accepted")
    if request.decision == "needs_revision" and document.admission_state == "rejected":
        raise ValueError("rejected tenant evidence cannot be converted to needs_revision")

    return TenantEvidenceReview(
        id=_review_id(document, actor, request, reviewed_at),
        document_id=document.id,
        tenant_id=document.tenant_id,
        decision=request.decision,
        reason_codes=sorted(set(request.reason_codes)),
        rationale=request.rationale,
        reviewed_by=actor.actor_id,
        reviewed_at=reviewed_at,
    )


def persist_tenant_evidence_document(
    connection: ConnectionLike,
    document: TenantEvidenceDocument,
    *,
    actor_tenant_id: str,
) -> None:
    if document.tenant_id != actor_tenant_id:
        raise ValueError("tenant evidence document tenant does not match authenticated actor tenant")
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.tenant_id', %s, true)", (actor_tenant_id,))
        cursor.execute(
            """
            INSERT INTO cbcap.tenant_evidence_document (
              id, tenant_id, geography_ids, submitted_in_run_id,
              storage_bucket, storage_key, storage_version_id,
              content_hash, byte_length, media_type, encryption_mode,
              kms_key_arn, public_access_blocked,
              document_type, source_label, sensitivity, rights_basis,
              usage_rights_confirmed, aggregation_level,
              contains_phi, contains_individual_health_records,
              contains_credentials_or_secrets, admission_state, reason_codes,
              submitted_by, submitted_at, retention_until
            ) VALUES (
              %s,%s,%s::jsonb,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s,
              %s,%s,%s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s
            ) ON CONFLICT (id) DO NOTHING
            """,
            (
                document.id,
                document.tenant_id,
                json.dumps(document.geography_ids),
                document.submitted_in_run_id,
                document.stored_object.bucket,
                document.stored_object.key,
                document.stored_object.version_id,
                document.stored_object.content_hash,
                document.stored_object.byte_length,
                document.stored_object.media_type,
                document.stored_object.encryption_mode,
                document.stored_object.kms_key_arn,
                document.stored_object.public_access_blocked,
                document.document_type,
                document.source_label,
                document.sensitivity,
                document.rights_basis,
                document.usage_rights_confirmed,
                document.aggregation_level,
                document.contains_phi,
                document.contains_individual_health_records,
                document.contains_credentials_or_secrets,
                document.admission_state,
                json.dumps(document.reason_codes),
                document.submitted_by,
                document.submitted_at,
                document.retention_until,
            ),
        )


def persist_tenant_evidence_review(
    connection: ConnectionLike,
    review: TenantEvidenceReview,
    *,
    actor_tenant_id: str,
) -> None:
    if review.tenant_id != actor_tenant_id:
        raise ValueError("tenant evidence review tenant does not match authenticated actor tenant")
    with connection.cursor() as cursor:
        cursor.execute("SELECT set_config('app.tenant_id', %s, true)", (actor_tenant_id,))
        cursor.execute(
            """
            INSERT INTO cbcap.tenant_evidence_review (
              id, document_id, tenant_id, decision, reason_codes,
              rationale, reviewed_by, reviewed_at
            ) VALUES (%s,%s,%s,%s,%s::jsonb,%s,%s,%s)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                review.id,
                review.document_id,
                review.tenant_id,
                review.decision,
                json.dumps(review.reason_codes),
                review.rationale,
                review.reviewed_by,
                review.reviewed_at,
            ),
        )


def record_tenant_evidence_submission(
    connection: ConnectionLike,
    request: TenantEvidenceSubmissionRequest,
    *,
    actor: AuthorizedActor,
) -> TenantEvidenceDocument:
    document = assess_tenant_evidence_submission(request, actor=actor)
    persist_tenant_evidence_document(
        connection,
        document,
        actor_tenant_id=document.tenant_id,
    )
    return document


def record_tenant_evidence_review(
    connection: ConnectionLike,
    request: TenantEvidenceReviewRequest,
    *,
    actor: AuthorizedActor,
) -> TenantEvidenceReview:
    review = review_tenant_evidence(request, actor=actor)
    persist_tenant_evidence_review(
        connection,
        review,
        actor_tenant_id=review.tenant_id,
    )
    return review

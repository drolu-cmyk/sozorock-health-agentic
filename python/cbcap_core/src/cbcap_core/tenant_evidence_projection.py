from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import Field

from .authorization import AuthorizedActor, require_actor_capability
from .models import CountyRunState, StrictModel
from .tenant_evidence import TenantEvidenceDocument, TenantEvidenceReview
from .tenant_evidence_use import latest_tenant_evidence_review

TenantEvidenceProjectionStatus = Literal["ready", "blocked"]
TenantEvidenceOverlayRelationship = Literal[
    "document_applies_to_geography",
    "document_accepted_by_review",
    "document_originated_in_run",
    "document_available_to_current_run",
]


class TenantEvidenceRunUseDecision(StrictModel):
    status: TenantEvidenceProjectionStatus
    document_id: str = Field(min_length=1)
    current_run_id: str = Field(min_length=1)
    latest_review_id: str | None = None
    reason_codes: list[str] = Field(default_factory=list)


class TenantEvidenceOverlayDocument(StrictModel):
    """Safe graph metadata only. Storage location and raw document content are excluded."""

    document_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    geography_ids: list[str] = Field(min_length=1)
    source_label: str = Field(min_length=1)
    document_type: str = Field(min_length=1)
    sensitivity: str = Field(min_length=1)
    content_hash: str = Field(pattern=r"^sha256:[0-9a-fA-F]{64}$")
    submitted_in_run_id: str = Field(min_length=1)
    latest_review_id: str = Field(min_length=1)
    latest_reviewed_at: datetime


class TenantEvidenceOverlayEdge(StrictModel):
    id: str = Field(min_length=1)
    relationship: TenantEvidenceOverlayRelationship
    from_id: str = Field(min_length=1)
    to_id: str = Field(min_length=1)


class TenantEvidenceGraphOverlay(StrictModel):
    schema_version: Literal["cbcap.tenant-evidence-overlay.v1"] = "cbcap.tenant-evidence-overlay.v1"
    tenant_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    documents: list[TenantEvidenceOverlayDocument] = Field(default_factory=list)
    edges: list[TenantEvidenceOverlayEdge] = Field(default_factory=list)
    blocked_document_ids: list[str] = Field(default_factory=list)


def authorize_tenant_evidence_for_run(
    run: CountyRunState,
    document: TenantEvidenceDocument,
    reviews: list[TenantEvidenceReview],
    *,
    actor: AuthorizedActor,
    as_of: datetime | None = None,
) -> TenantEvidenceRunUseDecision:
    """Authorize accepted organization evidence for the current planning cycle.

    The original submission run is provenance only. Access is decided against
    the current run so reviewed organization evidence can compound across
    planning cycles without requiring stale historical run grants.
    """

    now = as_of or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("tenant evidence projection time must be timezone-aware")
    if run.tenant_id is None:
        raise ValueError("tenant evidence projection requires a tenant-scoped county run")
    if actor.tenant_id != run.tenant_id or document.tenant_id != run.tenant_id:
        raise ValueError("tenant evidence projection tenant boundary mismatch")

    require_actor_capability(
        actor,
        "read_workspace",
        geography_id=run.county.id,
        run_id=run.run_id,
        as_of=now,
    )

    reasons: list[str] = []
    if run.county.id not in document.geography_ids:
        reasons.append("document_not_applicable_to_current_geography")
    if document.admission_state != "eligible_for_review":
        reasons.append(f"admission:{document.admission_state}")
    if document.retention_until is not None and now.date() > document.retention_until:
        reasons.append("retention_expired")

    latest = latest_tenant_evidence_review(document, reviews)
    if latest is None:
        reasons.append("human_review_missing")
    elif latest.decision != "accepted":
        reasons.append(f"latest_review:{latest.decision}")

    return TenantEvidenceRunUseDecision(
        status="blocked" if reasons else "ready",
        document_id=document.id,
        current_run_id=run.run_id,
        latest_review_id=latest.id if latest is not None else None,
        reason_codes=sorted(set(reasons)),
    )


def _edge(
    relationship: TenantEvidenceOverlayRelationship,
    document_id: str,
    target_id: str,
) -> TenantEvidenceOverlayEdge:
    return TenantEvidenceOverlayEdge(
        id=f"tenant-edge:{relationship}:{document_id}:{target_id}",
        relationship=relationship,
        from_id=document_id,
        to_id=target_id,
    )


def build_tenant_evidence_overlay(
    run: CountyRunState,
    documents: list[TenantEvidenceDocument],
    reviews: list[TenantEvidenceReview],
    *,
    actor: AuthorizedActor,
    as_of: datetime | None = None,
) -> TenantEvidenceGraphOverlay:
    if run.tenant_id is None:
        raise ValueError("tenant evidence overlay requires a tenant-scoped county run")
    if actor.tenant_id != run.tenant_id:
        raise ValueError("tenant evidence overlay tenant does not match authenticated actor tenant")

    ready_documents: list[TenantEvidenceOverlayDocument] = []
    edges: list[TenantEvidenceOverlayEdge] = []
    blocked: list[str] = []

    for document in documents:
        decision = authorize_tenant_evidence_for_run(
            run,
            document,
            reviews,
            actor=actor,
            as_of=as_of,
        )
        if decision.status != "ready" or decision.latest_review_id is None:
            blocked.append(document.id)
            continue
        latest = latest_tenant_evidence_review(document, reviews)
        if latest is None:
            blocked.append(document.id)
            continue

        ready_documents.append(
            TenantEvidenceOverlayDocument(
                document_id=document.id,
                tenant_id=document.tenant_id,
                geography_ids=document.geography_ids,
                source_label=document.source_label,
                document_type=document.document_type,
                sensitivity=document.sensitivity,
                content_hash=document.stored_object.content_hash,
                submitted_in_run_id=document.submitted_in_run_id,
                latest_review_id=latest.id,
                latest_reviewed_at=latest.reviewed_at,
            )
        )
        edges.append(
            _edge(
                "document_applies_to_geography",
                document.id,
                run.county.id,
            )
        )
        edges.append(
            _edge(
                "document_accepted_by_review",
                document.id,
                latest.id,
            )
        )
        edges.append(
            _edge(
                "document_originated_in_run",
                document.id,
                document.submitted_in_run_id,
            )
        )
        edges.append(
            _edge(
                "document_available_to_current_run",
                document.id,
                run.run_id,
            )
        )

    return TenantEvidenceGraphOverlay(
        tenant_id=run.tenant_id,
        run_id=run.run_id,
        geography_id=run.county.id,
        documents=ready_documents,
        edges=edges,
        blocked_document_ids=sorted(set(blocked)),
    )

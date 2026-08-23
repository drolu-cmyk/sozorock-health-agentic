from __future__ import annotations

from datetime import date, datetime, timezone
from typing import Literal

from pydantic import Field

from .authorization import AuthorizedActor, require_actor_capability
from .models import StrictModel
from .tenant_evidence import TenantEvidenceDocument, TenantEvidenceReview

TenantEvidenceUseStatus = Literal["ready", "blocked"]


class TenantEvidenceUseDecision(StrictModel):
    status: TenantEvidenceUseStatus
    document_id: str = Field(min_length=1)
    latest_review_id: str | None = None
    reason_codes: list[str] = Field(default_factory=list)


def latest_tenant_evidence_review(
    document: TenantEvidenceDocument,
    reviews: list[TenantEvidenceReview],
) -> TenantEvidenceReview | None:
    matching = [
        item
        for item in reviews
        if item.document_id == document.id and item.tenant_id == document.tenant_id
    ]
    if not matching:
        return None
    return max(matching, key=lambda item: (item.reviewed_at, item.id))


def authorize_tenant_evidence_use(
    document: TenantEvidenceDocument,
    reviews: list[TenantEvidenceReview],
    *,
    actor: AuthorizedActor,
    as_of: datetime | None = None,
) -> TenantEvidenceUseDecision:
    """Authorize private evidence for tenant-only graph/workspace use.

    This does not make the document public and does not copy it into the public
    Evidence Gateway. The latest review controls use, so a later rejection or
    needs-revision decision supersedes an earlier acceptance without rewriting
    immutable history.
    """

    now = as_of or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("tenant evidence use evaluation time must be timezone-aware")
    if actor.tenant_id != document.tenant_id:
        raise ValueError("tenant evidence use tenant does not match authenticated actor tenant")

    for geography_id in document.geography_ids:
        require_actor_capability(
            actor,
            "read_workspace",
            geography_id=geography_id,
            run_id=document.submitted_in_run_id,
            as_of=now,
        )

    reasons: list[str] = []
    if document.admission_state != "eligible_for_review":
        reasons.append(f"admission:{document.admission_state}")
    if document.retention_until is not None and now.date() > document.retention_until:
        reasons.append("retention_expired")

    latest = latest_tenant_evidence_review(document, reviews)
    if latest is None:
        reasons.append("human_review_missing")
    elif latest.decision != "accepted":
        reasons.append(f"latest_review:{latest.decision}")

    return TenantEvidenceUseDecision(
        status="blocked" if reasons else "ready",
        document_id=document.id,
        latest_review_id=latest.id if latest is not None else None,
        reason_codes=sorted(set(reasons)),
    )

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Literal

from pydantic import Field

from .authorization import AuthorizedActor, require_actor_capability
from .evidence_graph_policy import build_governed_evidence_graph
from .models import CountyRunState, StrictModel
from .tenant_evidence import TenantEvidenceDocument, TenantEvidenceReview
from .tenant_evidence_projection import (
    TenantEvidenceGraphOverlay,
    build_tenant_evidence_overlay,
)

TenantEvidencePlanningTarget = Literal[
    "evidence_claim",
    "barrier_observation",
    "plan_priority",
    "organization",
    "funding_fit",
    "scenario_assumption",
]


class TenantEvidenceLinkIntent(StrictModel):
    document_id: str = Field(min_length=1)
    target_type: TenantEvidencePlanningTarget
    target_entity_id: str = Field(min_length=1)
    rationale: str = Field(min_length=1, max_length=2000)


class TenantEvidencePlanningLink(StrictModel):
    schema_version: Literal["cbcap.tenant-evidence-planning-link.v1"] = (
        "cbcap.tenant-evidence-planning-link.v1"
    )
    id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    document_id: str = Field(min_length=1)
    document_content_hash: str = Field(pattern=r"^sha256:[0-9a-fA-F]{64}$")
    source_review_id: str = Field(min_length=1)
    target_type: TenantEvidencePlanningTarget
    target_entity_id: str = Field(min_length=1)
    rationale: str = Field(min_length=1, max_length=2000)
    proposed_by: str = Field(min_length=1)
    proposed_at: datetime
    status: Literal["provisional"] = "provisional"
    visibility: Literal["tenant"] = "tenant"
    authoritative: Literal[False] = False


class TenantEvidencePlanningContext(StrictModel):
    schema_version: Literal["cbcap.tenant-evidence-planning-context.v1"] = (
        "cbcap.tenant-evidence-planning-context.v1"
    )
    tenant_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    overlay: TenantEvidenceGraphOverlay
    links: list[TenantEvidencePlanningLink] = Field(default_factory=list)


def _link_id(
    *,
    overlay_document,
    intent: TenantEvidenceLinkIntent,
    actor: AuthorizedActor,
) -> str:
    identity = {
        "tenant_id": overlay_document.tenant_id,
        "document_id": overlay_document.document_id,
        "content_hash": overlay_document.content_hash,
        "review_id": overlay_document.latest_review_id,
        "target_type": intent.target_type,
        "target_entity_id": intent.target_entity_id,
        "rationale": intent.rationale,
        "proposed_by": actor.actor_id,
    }
    digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"tenant-evidence-link:sha256:{digest}"


def link_tenant_evidence_to_planning_state(
    run: CountyRunState,
    overlay: TenantEvidenceGraphOverlay,
    intents: list[TenantEvidenceLinkIntent],
    *,
    actor: AuthorizedActor,
    as_of: datetime | None = None,
) -> list[TenantEvidencePlanningLink]:
    """Create provisional tenant-only relationships to canonical planning state.

    The link carries only reviewed document identity, content hash and review
    provenance. It never carries storage location, KMS metadata or raw content,
    and it never becomes authoritative merely because the document was accepted.
    """

    now = as_of or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("tenant evidence linkage time must be timezone-aware")
    if run.tenant_id is None:
        raise ValueError("tenant evidence linkage requires a tenant-scoped county run")
    if actor.tenant_id != run.tenant_id:
        raise ValueError("tenant evidence linkage actor tenant does not match county run tenant")
    if (
        overlay.tenant_id != run.tenant_id
        or overlay.run_id != run.run_id
        or overlay.geography_id != run.county.id
    ):
        raise ValueError("tenant evidence overlay does not match current county run scope")

    require_actor_capability(
        actor,
        "record_workspace_proposal",
        geography_id=run.county.id,
        run_id=run.run_id,
        as_of=now,
    )

    graph = build_governed_evidence_graph(run)
    if graph.status != "ready":
        raise ValueError("tenant evidence cannot link to a blocked governed evidence graph")

    allowed_targets = {
        (node.node_type, node.entity_id): node
        for node in graph.nodes
        if node.node_type
        in {
            "evidence_claim",
            "barrier_observation",
            "plan_priority",
            "organization",
            "funding_fit",
            "scenario_assumption",
        }
    }
    documents = {document.document_id: document for document in overlay.documents}

    links: list[TenantEvidencePlanningLink] = []
    seen_pairs: set[tuple[str, str, str]] = set()
    for intent in intents:
        document = documents.get(intent.document_id)
        if document is None:
            raise ValueError(
                "tenant evidence link references a document that is not authorized in the current overlay"
            )
        target_key = (intent.target_type, intent.target_entity_id)
        target = allowed_targets.get(target_key)
        if target is None:
            raise ValueError("tenant evidence link target is not present in canonical planning state")
        if target.tenant_id is not None and target.tenant_id != run.tenant_id:
            raise ValueError("tenant evidence link target belongs to another tenant")

        pair = (document.document_id, intent.target_type, intent.target_entity_id)
        if pair in seen_pairs:
            raise ValueError("duplicate tenant evidence planning link intent")
        seen_pairs.add(pair)

        links.append(
            TenantEvidencePlanningLink(
                id=_link_id(
                    overlay_document=document,
                    intent=intent,
                    actor=actor,
                ),
                tenant_id=run.tenant_id,
                run_id=run.run_id,
                geography_id=run.county.id,
                document_id=document.document_id,
                document_content_hash=document.content_hash,
                source_review_id=document.latest_review_id,
                target_type=intent.target_type,
                target_entity_id=intent.target_entity_id,
                rationale=intent.rationale,
                proposed_by=actor.actor_id,
                proposed_at=now,
            )
        )
    return links


def build_tenant_evidence_planning_context(
    run: CountyRunState,
    documents: list[TenantEvidenceDocument],
    reviews: list[TenantEvidenceReview],
    intents: list[TenantEvidenceLinkIntent],
    *,
    actor: AuthorizedActor,
    as_of: datetime | None = None,
) -> TenantEvidencePlanningContext:
    overlay = build_tenant_evidence_overlay(
        run,
        documents,
        reviews,
        actor=actor,
        as_of=as_of,
    )
    links = link_tenant_evidence_to_planning_state(
        run,
        overlay,
        intents,
        actor=actor,
        as_of=as_of,
    )
    return TenantEvidencePlanningContext(
        tenant_id=run.tenant_id or "",
        run_id=run.run_id,
        geography_id=run.county.id,
        overlay=overlay,
        links=links,
    )

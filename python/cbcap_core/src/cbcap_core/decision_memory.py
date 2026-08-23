from __future__ import annotations

import hashlib
import json
from datetime import datetime
from typing import Literal

from pydantic import Field, model_validator

from .models import StrictModel

MemoryDecisionType = Literal[
    "planning_interpretation",
    "funding_fit",
    "partner_requirement",
    "scenario_decision",
    "evidence_correction",
    "publication_decision",
]
MemoryOutcome = Literal[
    "accepted",
    "rejected",
    "needs_revision",
    "deferred",
    "superseded",
]
ProposalOutcome = Literal[
    "accepted",
    "rejected",
    "needs_revision",
    "deferred",
]
MemoryStatus = Literal["proposed", "reviewed", "superseded"]
MemoryApplicability = Literal["context_specific", "reusable", "expired"]
MemoryActorRole = Literal["analyst", "planner", "reviewer", "admin"]


class DecisionMemoryRecord(StrictModel):
    """Tenant-private institutional decision memory, never conversation history."""

    id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    decision_type: MemoryDecisionType
    subject_type: str = Field(min_length=1)
    subject_id: str = Field(min_length=1)
    outcome: MemoryOutcome
    reason_codes: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)
    evidence_entity_ids: list[str] = Field(min_length=1)
    related_entity_ids: list[str] = Field(default_factory=list)
    missing_requirements: list[str] = Field(default_factory=list)
    decided_by: str = Field(min_length=1)
    decided_at: datetime
    status: MemoryStatus
    applicability: MemoryApplicability = "context_specific"
    supersedes_memory_id: str | None = None
    expires_at: datetime | None = None

    @model_validator(mode="after")
    def validate_lifecycle(self) -> "DecisionMemoryRecord":
        if self.status == "superseded" and self.outcome != "superseded":
            raise ValueError("superseded memory status requires superseded outcome")
        if self.outcome == "superseded" and not self.supersedes_memory_id:
            raise ValueError("superseded outcome requires supersedes_memory_id")
        if self.applicability == "expired" and self.expires_at is None:
            raise ValueError("expired applicability requires expires_at")
        return self


class DecisionMemoryProposal(StrictModel):
    tenant_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    decision_type: MemoryDecisionType
    subject_type: str = Field(min_length=1)
    subject_id: str = Field(min_length=1)
    outcome: ProposalOutcome
    reason_codes: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)
    evidence_entity_ids: list[str] = Field(min_length=1)
    related_entity_ids: list[str] = Field(default_factory=list)
    missing_requirements: list[str] = Field(default_factory=list)
    applicability: Literal["context_specific", "reusable"] = "context_specific"
    expires_at: datetime | None = None


class DecisionMemoryWriteRequest(StrictModel):
    proposal: DecisionMemoryProposal
    actor_tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: MemoryActorRole
    decided_at: datetime
    approve_as_reviewed: bool = False


class DecisionMemoryQuery(StrictModel):
    tenant_id: str = Field(min_length=1)
    geography_id: str | None = None
    decision_type: MemoryDecisionType | None = None
    subject_id: str | None = None
    include_proposed: bool = False
    include_expired: bool = False


def _stable_memory_id(prefix: str, payload: dict) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return f"memory:{prefix}:sha256:{hashlib.sha256(encoded).hexdigest()}"


def build_decision_memory(request: DecisionMemoryWriteRequest) -> DecisionMemoryRecord:
    proposal = request.proposal
    if request.actor_tenant_id != proposal.tenant_id:
        raise ValueError("decision memory tenant does not match authenticated actor tenant")
    if request.approve_as_reviewed and request.actor_role not in {"reviewer", "admin"}:
        raise ValueError("only reviewer or admin may create reviewed institutional memory")

    status: MemoryStatus = "reviewed" if request.approve_as_reviewed else "proposed"
    record_id = _stable_memory_id(
        "decision",
        {
            "proposal": proposal.model_dump(mode="json"),
            "actor_tenant_id": request.actor_tenant_id,
            "actor_id": request.actor_id,
            "actor_role": request.actor_role,
            "decided_at": request.decided_at.isoformat(),
            "status": status,
        },
    )
    return DecisionMemoryRecord(
        id=record_id,
        tenant_id=proposal.tenant_id,
        geography_id=proposal.geography_id,
        decision_type=proposal.decision_type,
        subject_type=proposal.subject_type,
        subject_id=proposal.subject_id,
        outcome=proposal.outcome,
        reason_codes=sorted(set(proposal.reason_codes)),
        rationale=proposal.rationale,
        evidence_entity_ids=list(dict.fromkeys(proposal.evidence_entity_ids)),
        related_entity_ids=list(dict.fromkeys(proposal.related_entity_ids)),
        missing_requirements=list(dict.fromkeys(proposal.missing_requirements)),
        decided_by=request.actor_id,
        decided_at=request.decided_at,
        status=status,
        applicability=proposal.applicability,
        expires_at=proposal.expires_at,
    )


def supersede_decision_memory(
    record: DecisionMemoryRecord,
    *,
    actor_tenant_id: str,
    actor_id: str,
    actor_role: MemoryActorRole,
    decided_at: datetime,
    reason_code: str,
    rationale: str,
) -> DecisionMemoryRecord:
    if actor_tenant_id != record.tenant_id:
        raise ValueError("decision memory tenant does not match authenticated actor tenant")
    if actor_role not in {"reviewer", "admin"}:
        raise ValueError("only reviewer or admin may supersede institutional memory")
    superseding_id = _stable_memory_id(
        "supersede",
        {
            "record_id": record.id,
            "actor_tenant_id": actor_tenant_id,
            "actor_id": actor_id,
            "actor_role": actor_role,
            "decided_at": decided_at.isoformat(),
            "reason_code": reason_code,
            "rationale": rationale,
        },
    )
    return DecisionMemoryRecord(
        id=superseding_id,
        tenant_id=record.tenant_id,
        geography_id=record.geography_id,
        decision_type=record.decision_type,
        subject_type=record.subject_type,
        subject_id=record.subject_id,
        outcome="superseded",
        reason_codes=[reason_code],
        rationale=rationale,
        evidence_entity_ids=record.evidence_entity_ids,
        related_entity_ids=[record.id, *record.related_entity_ids],
        missing_requirements=record.missing_requirements,
        decided_by=actor_id,
        decided_at=decided_at,
        status="superseded",
        applicability="expired",
        supersedes_memory_id=record.id,
        expires_at=decided_at,
    )


def query_decision_memory(
    records: list[DecisionMemoryRecord],
    query: DecisionMemoryQuery,
    *,
    actor_tenant_id: str,
    as_of: datetime,
) -> list[DecisionMemoryRecord]:
    if actor_tenant_id != query.tenant_id:
        raise ValueError("decision memory query tenant does not match authenticated actor tenant")

    result: list[DecisionMemoryRecord] = []
    for record in records:
        if record.tenant_id != query.tenant_id:
            continue
        if query.geography_id is not None and record.geography_id != query.geography_id:
            continue
        if query.decision_type is not None and record.decision_type != query.decision_type:
            continue
        if query.subject_id is not None and record.subject_id != query.subject_id:
            continue
        if not query.include_proposed and record.status != "reviewed":
            continue
        expired = record.expires_at is not None and record.expires_at <= as_of
        if expired and not query.include_expired:
            continue
        result.append(record)

    return sorted(result, key=lambda item: item.decided_at, reverse=True)

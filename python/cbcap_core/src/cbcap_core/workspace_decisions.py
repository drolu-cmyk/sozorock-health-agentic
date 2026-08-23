from __future__ import annotations

from datetime import datetime
from typing import Literal, cast

from pydantic import Field, model_validator

from .decision_memory import (
    DecisionMemoryProposal,
    DecisionMemoryRecord,
    DecisionMemoryWriteRequest,
    MemoryActorRole,
    ProposalOutcome,
    build_decision_memory,
)
from .models import CountyRunState, StrictModel
from .persistence import ConnectionLike, persist_decision_memory
from .planning_views import PlanningQuestion
from .workspace import (
    DecisionWorkspaceContract,
    DecisionWorkspaceRequest,
    WorkspaceRole,
    build_decision_workspace,
)

WorkspaceMemoryDecisionType = Literal[
    "planning_interpretation",
    "scenario_decision",
    "evidence_correction",
    "publication_decision",
]


class WorkspaceDecisionRequest(StrictModel):
    """Server-side command to convert a governed workspace decision into memory."""

    county_run: CountyRunState
    question: PlanningQuestion
    actor_tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: WorkspaceRole
    decision_type: WorkspaceMemoryDecisionType
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
    decided_at: datetime
    approve_as_reviewed: bool = False

    @model_validator(mode="after")
    def validate_command_shape(self) -> "WorkspaceDecisionRequest":
        if self.actor_role == "read_only":
            raise ValueError("read-only workspace role cannot record institutional decisions")
        if self.decision_type == "publication_decision" and not self.approve_as_reviewed:
            raise ValueError("publication decisions must be recorded as reviewed decisions")
        return self


class WorkspaceDecisionResult(StrictModel):
    workspace: DecisionWorkspaceContract
    memory: DecisionMemoryRecord


def _run_entity_ids(run: CountyRunState) -> set[str]:
    ids = {run.run_id, run.county.id}
    for attribute in (
        "source_documents",
        "evidence_claims",
        "measures",
        "barrier_observations",
        "barrier_patterns",
        "plan_documents",
        "plan_priorities",
        "organizations",
        "funding_opportunities",
        "funding_fits",
        "scenario_assumptions",
        "forecasts",
        "conflicts",
        "reviews",
        "agent_runs",
        "artifacts",
    ):
        for item in getattr(run, attribute):
            entity_id = getattr(item, "id", None)
            if entity_id:
                ids.add(entity_id)
    return ids


def _scenario_entity_ids(run: CountyRunState) -> set[str]:
    return {
        *[item.id for item in run.scenario_assumptions],
        *[item.id for item in run.forecasts],
    }


def _blocker_entity_ids(workspace: DecisionWorkspaceContract) -> set[str]:
    return {
        entity_id
        for blocker in workspace.blockers
        for entity_id in blocker.entity_ids
    }


def _reviewable_evidence_ids(
    request: WorkspaceDecisionRequest,
    workspace: DecisionWorkspaceContract,
) -> set[str]:
    authoritative = set(workspace.authoritative_entity_ids)
    if request.decision_type == "publication_decision" and request.outcome != "accepted":
        return authoritative | _blocker_entity_ids(workspace)
    return authoritative


def _validate_workspace_decision(
    request: WorkspaceDecisionRequest,
    workspace: DecisionWorkspaceContract,
) -> None:
    run = request.county_run
    if run.tenant_id is None:
        raise ValueError("institutional workspace decisions require a tenant-scoped county run")
    if run.tenant_id != request.actor_tenant_id:
        raise ValueError("workspace decision tenant does not match authenticated actor tenant")

    entity_ids = _run_entity_ids(run)
    if request.subject_id not in entity_ids:
        raise ValueError("workspace decision subject is not part of the canonical county run")
    unknown_related = sorted(set(request.related_entity_ids) - entity_ids)
    if unknown_related:
        raise ValueError(
            "workspace decision related entities are not part of the canonical county run: "
            + ", ".join(unknown_related)
        )

    if request.decision_type == "scenario_decision":
        if request.subject_id not in _scenario_entity_ids(run):
            raise ValueError("scenario decision subject must be a scenario assumption or forecast")
        if "create_scenario" not in workspace.allowed_actions:
            raise ValueError("scenario decision is not permitted in the current governed workspace")

    if request.decision_type == "publication_decision":
        if request.actor_role not in {"reviewer", "admin"}:
            raise ValueError("only reviewer or admin may record publication decisions")
        if request.subject_id != run.run_id:
            raise ValueError("publication decision subject must be the county run")
        if request.outcome == "accepted":
            if "approve_publication" not in workspace.allowed_actions:
                raise ValueError("publication approval is not permitted in the current governed workspace")
            if workspace.publication_state != "safe_not_approved":
                raise ValueError("publication approval requires safe_not_approved workspace state")

    referenced_evidence = set(request.evidence_entity_ids)
    if request.approve_as_reviewed:
        permitted = _reviewable_evidence_ids(request, workspace)
        unsupported = sorted(referenced_evidence - permitted)
        if unsupported:
            raise ValueError(
                "reviewed workspace decision references evidence outside governed lineage: "
                + ", ".join(unsupported)
            )
    else:
        unknown = sorted(referenced_evidence - entity_ids)
        if unknown:
            raise ValueError(
                "workspace decision references entities outside the canonical county run: "
                + ", ".join(unknown)
            )

    if request.approve_as_reviewed and request.actor_role not in {"reviewer", "admin"}:
        raise ValueError("only reviewer or admin may create reviewed workspace memory")


def prepare_workspace_decision(
    request: WorkspaceDecisionRequest,
) -> WorkspaceDecisionResult:
    """Rebuild governed state, validate the command, then create memory.

    The caller does not supply a trusted DecisionWorkspaceContract. It is always
    rebuilt from canonical county state inside this service boundary.
    """

    workspace = build_decision_workspace(
        DecisionWorkspaceRequest(
            county_run=request.county_run,
            question=request.question,
            role=request.actor_role,
            actor_tenant_id=request.actor_tenant_id,
        )
    )
    _validate_workspace_decision(request, workspace)

    proposal = DecisionMemoryProposal(
        tenant_id=request.actor_tenant_id,
        geography_id=request.county_run.county.id,
        decision_type=request.decision_type,
        subject_type=request.subject_type,
        subject_id=request.subject_id,
        outcome=request.outcome,
        reason_codes=request.reason_codes,
        rationale=request.rationale,
        evidence_entity_ids=request.evidence_entity_ids,
        related_entity_ids=request.related_entity_ids,
        missing_requirements=request.missing_requirements,
        applicability=request.applicability,
        expires_at=request.expires_at,
    )
    memory = build_decision_memory(
        DecisionMemoryWriteRequest(
            proposal=proposal,
            actor_tenant_id=request.actor_tenant_id,
            actor_id=request.actor_id,
            actor_role=cast(MemoryActorRole, request.actor_role),
            decided_at=request.decided_at,
            approve_as_reviewed=request.approve_as_reviewed,
        )
    )
    return WorkspaceDecisionResult(workspace=workspace, memory=memory)


def record_workspace_decision(
    connection: ConnectionLike,
    request: WorkspaceDecisionRequest,
) -> WorkspaceDecisionResult:
    result = prepare_workspace_decision(request)
    persist_decision_memory(
        connection,
        result.memory,
        actor_tenant_id=request.actor_tenant_id,
    )
    return result

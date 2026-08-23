from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal, cast

from pydantic import Field

from .decision_memory import (
    DecisionMemoryProposal,
    DecisionMemoryRecord,
    DecisionMemoryWriteRequest,
    MemoryActorRole,
    MemoryDecisionType,
    ProposalOutcome,
    build_decision_memory,
)
from .models import CountyRunState, StrictModel
from .persistence import ConnectionLike, persist_decision_memory
from .planning_views import PlanningQuestion
from .runtime_service import RuntimeActor
from .workspace import (
    DecisionWorkspaceContract,
    DecisionWorkspaceRequest,
    build_decision_workspace,
)

WorkspaceDecisionAction = Literal[
    "inspect_evidence",
    "compare_barriers",
    "compare_plans",
    "review_conflicts",
    "create_scenario",
    "inspect_funding",
]
WorkspaceMemoryDecisionType = Literal[
    "planning_interpretation",
    "funding_fit",
    "partner_requirement",
    "scenario_decision",
    "evidence_correction",
]

_ACTION_DECISION_TYPES: dict[WorkspaceDecisionAction, frozenset[MemoryDecisionType]] = {
    "inspect_evidence": frozenset({"planning_interpretation", "evidence_correction"}),
    "compare_barriers": frozenset({"planning_interpretation"}),
    "compare_plans": frozenset({"planning_interpretation"}),
    "review_conflicts": frozenset({"planning_interpretation", "evidence_correction"}),
    "create_scenario": frozenset({"scenario_decision"}),
    "inspect_funding": frozenset({"funding_fit", "partner_requirement"}),
}


class WorkspaceDecisionRequest(StrictModel):
    """Decision intent only. Identity, review authority and time are not caller fields."""

    county_run: CountyRunState
    question: PlanningQuestion
    action: WorkspaceDecisionAction
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


def _validate_workspace_decision(
    request: WorkspaceDecisionRequest,
    actor: RuntimeActor,
    workspace: DecisionWorkspaceContract,
) -> None:
    run = request.county_run
    if run.tenant_id is None:
        raise ValueError("institutional workspace decisions require a tenant-scoped county run")
    if run.tenant_id != actor.tenant_id:
        raise ValueError("workspace decision tenant does not match authenticated actor tenant")
    if actor.role == "read_only":
        raise PermissionError("read-only actors cannot record institutional decisions")
    if request.action not in workspace.allowed_actions:
        raise PermissionError("workspace action is not authorized by the current governed workspace")
    if request.decision_type not in _ACTION_DECISION_TYPES[request.action]:
        raise ValueError("workspace action and institutional decision type are incompatible")

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
        scenario_ids = {
            *[item.id for item in run.scenario_assumptions],
            *[item.id for item in run.forecasts],
        }
        if request.subject_id not in scenario_ids:
            raise ValueError("scenario decision subject must be a scenario assumption or forecast")

    referenced_evidence = set(request.evidence_entity_ids)
    if actor.role in {"reviewer", "admin"}:
        permitted = set(workspace.authoritative_entity_ids)
        unsupported = sorted(referenced_evidence - permitted)
        if unsupported:
            raise ValueError(
                "reviewed workspace decision references evidence outside governed authoritative lineage: "
                + ", ".join(unsupported)
            )
    else:
        unknown = sorted(referenced_evidence - entity_ids)
        if unknown:
            raise ValueError(
                "workspace decision references entities outside the canonical county run: "
                + ", ".join(unknown)
            )


def prepare_workspace_decision(
    request: WorkspaceDecisionRequest,
    *,
    actor: RuntimeActor,
) -> WorkspaceDecisionResult:
    """Rebuild governed state and convert decision intent into institutional memory.

    Review status, actor identity, tenant identity and decision time are derived
    inside the trusted service boundary. Publication approval is intentionally
    excluded because it must be atomic with canonical workflow-state mutation.
    """

    workspace = build_decision_workspace(
        DecisionWorkspaceRequest(
            county_run=request.county_run,
            question=request.question,
            role=actor.role,
            actor_tenant_id=actor.tenant_id,
        )
    )
    _validate_workspace_decision(request, actor, workspace)

    tenant_id = request.county_run.tenant_id
    if tenant_id is None:  # narrowed above; explicit for static typing
        raise ValueError("institutional workspace decisions require tenant identity")

    proposal = DecisionMemoryProposal(
        tenant_id=tenant_id,
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
    )
    memory = build_decision_memory(
        DecisionMemoryWriteRequest(
            proposal=proposal,
            actor_tenant_id=tenant_id,
            actor_id=actor.actor_id,
            actor_role=cast(MemoryActorRole, actor.role),
            decided_at=datetime.now(timezone.utc),
            approve_as_reviewed=actor.role in {"reviewer", "admin"},
        )
    )
    return WorkspaceDecisionResult(workspace=workspace, memory=memory)


def record_workspace_decision(
    connection: ConnectionLike,
    request: WorkspaceDecisionRequest,
    *,
    actor: RuntimeActor,
) -> WorkspaceDecisionResult:
    result = prepare_workspace_decision(request, actor=actor)
    tenant_id = request.county_run.tenant_id
    if tenant_id is None:
        raise ValueError("institutional workspace decisions require tenant identity")
    persist_decision_memory(
        connection,
        result.memory,
        actor_tenant_id=tenant_id,
    )
    return result

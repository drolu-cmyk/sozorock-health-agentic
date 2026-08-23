from __future__ import annotations

from typing import Literal

from pydantic import Field

from .evidence_graph import EvidenceGraphSnapshot
from .evidence_graph_policy import build_governed_evidence_graph
from .models import CountyRunState, ReviewStatus, StrictModel
from .planning_views import (
    PlanningQuestion,
    PlanningViewDecision,
    PlanningViewRequest,
    select_planning_view,
)

WorkspaceRole = Literal["read_only", "analyst", "planner", "reviewer", "admin"]
WorkspaceAction = Literal[
    "inspect_evidence",
    "compare_barriers",
    "compare_plans",
    "review_conflicts",
    "create_scenario",
    "inspect_funding",
    "request_review",
    "approve_publication",
    "export_draft",
]
BlockerSeverity = Literal["information", "review_required", "blocking"]


class WorkspaceBlocker(StrictModel):
    code: str = Field(min_length=1)
    severity: BlockerSeverity
    message: str = Field(min_length=1)
    entity_ids: list[str] = Field(default_factory=list)


class WorkspaceEvidenceStatus(StrictModel):
    verified_measures: int = Field(ge=0)
    provisional_measures: int = Field(ge=0)
    verified_barriers: int = Field(ge=0)
    provisional_barriers: int = Field(ge=0)
    verified_plans: int = Field(ge=0)
    provisional_plans: int = Field(ge=0)
    verified_claims: int = Field(ge=0)
    provisional_claims: int = Field(ge=0)
    verified_funding_opportunities: int = Field(ge=0)
    provisional_funding_opportunities: int = Field(ge=0)
    blocking_conflicts: int = Field(ge=0)


class DecisionWorkspaceRequest(StrictModel):
    county_run: CountyRunState
    question: PlanningQuestion
    role: WorkspaceRole
    actor_tenant_id: str | None = None
    mobile: bool = False


class DecisionWorkspaceContract(StrictModel):
    schema_version: Literal["cbcap.decision-workspace.v1"] = "cbcap.decision-workspace.v1"
    run_id: str = Field(min_length=1)
    tenant_id: str | None = None
    county_id: str = Field(min_length=1)
    county_name: str = Field(min_length=1)
    role: WorkspaceRole
    question: PlanningQuestion
    evidence_status: WorkspaceEvidenceStatus
    evidence_graph_status: Literal["ready", "blocked"]
    authoritative_relationship_count: int = Field(ge=0)
    view: PlanningViewDecision
    blockers: list[WorkspaceBlocker] = Field(default_factory=list)
    allowed_actions: list[WorkspaceAction] = Field(default_factory=list)
    publication_state: Literal[
        "not_ready",
        "review_required",
        "safe_not_approved",
        "approved",
    ]
    authoritative_entity_ids: list[str] = Field(default_factory=list)


def _count_status(items) -> tuple[int, int]:
    verified = sum(item.review_status == ReviewStatus.VERIFIED for item in items)
    provisional = sum(item.review_status != ReviewStatus.VERIFIED for item in items)
    return verified, provisional


def _has_time_semantics(run: CountyRunState) -> bool:
    dated_plans = [
        item
        for item in run.plan_documents
        if item.published_at is not None or item.period_start is not None or item.period_end is not None
    ]
    dated_measures = [
        item
        for item in run.measures
        if item.data_period_start is not None or item.data_period_end is not None
    ]
    dated_funding = [
        item
        for item in run.funding_opportunities
        if item.open_date is not None or item.close_date is not None
    ]
    return len(dated_plans) + len(dated_measures) + len(dated_funding) >= 2


def _planning_view_request(
    run: CountyRunState,
    graph: EvidenceGraphSnapshot,
    *,
    question: PlanningQuestion,
    mobile: bool,
) -> PlanningViewRequest:
    verified_barriers = [
        item for item in run.barrier_observations if item.review_status == ReviewStatus.VERIFIED
    ]
    verified_plans = [item for item in run.plan_documents if item.review_status == ReviewStatus.VERIFIED]
    verified_funding = [
        item for item in run.funding_opportunities if item.review_status == ReviewStatus.VERIFIED
    ]
    verified_fits = [item for item in run.funding_fits if item.review_status == ReviewStatus.VERIFIED]
    scenario_projections = [
        item
        for item in run.forecasts
        if item.review_status == ReviewStatus.VERIFIED and item.forecast_type == "scenario_projection"
    ]
    implementation_claims = [
        item
        for item in run.evidence_claims
        if item.review_status == ReviewStatus.VERIFIED
        and item.claim_type in {"objective", "intervention", "action", "evaluation_measure"}
    ]

    authoritative_edges = graph.authoritative_edges if graph.status == "ready" else []
    relationship_node_ids = {
        node_id
        for edge in authoritative_edges
        for node_id in (edge.from_node_id, edge.to_node_id)
    }
    evidence_events = (
        len([item for item in run.measures if item.review_status == ReviewStatus.VERIFIED])
        + len(verified_plans)
        + len([item for item in run.evidence_claims if item.review_status == ReviewStatus.VERIFIED])
    )
    return PlanningViewRequest(
        question=question,
        barrier_count=len(verified_barriers),
        plan_count=len(verified_plans),
        evidence_events=evidence_events,
        scenario_count=len(scenario_projections),
        funding_opportunity_count=len(verified_funding) + len(verified_fits),
        implementation_item_count=len(implementation_claims),
        relationship_node_count=len(relationship_node_ids),
        relationship_edge_count=len(authoritative_edges),
        has_verified_lineage=graph.status == "ready" and bool(authoritative_edges),
        has_time_semantics=_has_time_semantics(run),
        mobile=mobile,
    )


def _evidence_status(run: CountyRunState) -> WorkspaceEvidenceStatus:
    verified_measures, provisional_measures = _count_status(run.measures)
    verified_barriers, provisional_barriers = _count_status(run.barrier_observations)
    verified_plans, provisional_plans = _count_status(run.plan_documents)
    verified_claims, provisional_claims = _count_status(run.evidence_claims)
    verified_funding, provisional_funding = _count_status(run.funding_opportunities)
    return WorkspaceEvidenceStatus(
        verified_measures=verified_measures,
        provisional_measures=provisional_measures,
        verified_barriers=verified_barriers,
        provisional_barriers=provisional_barriers,
        verified_plans=verified_plans,
        provisional_plans=provisional_plans,
        verified_claims=verified_claims,
        provisional_claims=provisional_claims,
        verified_funding_opportunities=verified_funding,
        provisional_funding_opportunities=provisional_funding,
        blocking_conflicts=sum(item.blocking for item in run.conflicts),
    )


def _blockers(
    run: CountyRunState,
    view: PlanningViewDecision,
    graph: EvidenceGraphSnapshot,
) -> list[WorkspaceBlocker]:
    blockers: list[WorkspaceBlocker] = []

    for issue in graph.integrity_issues:
        blockers.append(
            WorkspaceBlocker(
                code=f"evidence_graph_{issue.code}",
                severity=issue.severity,
                message=issue.message,
                entity_ids=issue.entity_ids,
            )
        )

    blocking_conflicts = [item for item in run.conflicts if item.blocking]
    if blocking_conflicts:
        blockers.append(
            WorkspaceBlocker(
                code="blocking_conflict",
                severity="blocking",
                message="One or more evidence conflicts require resolution before governed publication.",
                entity_ids=[item.id for item in blocking_conflicts],
            )
        )

    provisional_ids = [
        *[item.id for item in run.source_documents if item.review_status != ReviewStatus.VERIFIED],
        *[item.id for item in run.evidence_claims if item.review_status != ReviewStatus.VERIFIED],
        *[item.id for item in run.measures if item.review_status != ReviewStatus.VERIFIED],
        *[item.id for item in run.barrier_observations if item.review_status != ReviewStatus.VERIFIED],
        *[item.id for item in run.plan_documents if item.review_status != ReviewStatus.VERIFIED],
        *[item.id for item in run.plan_priorities if item.review_status != ReviewStatus.VERIFIED],
        *[item.id for item in run.funding_opportunities if item.review_status != ReviewStatus.VERIFIED],
        *[item.id for item in run.funding_fits if item.review_status != ReviewStatus.VERIFIED],
        *[item.id for item in run.forecasts if item.review_status != ReviewStatus.VERIFIED],
    ]
    if provisional_ids:
        blockers.append(
            WorkspaceBlocker(
                code="provisional_evidence",
                severity="review_required",
                message="Provisional planning evidence is visible for review but is not authoritative.",
                entity_ids=list(dict.fromkeys(provisional_ids)),
            )
        )

    if view.status == "blocked":
        blockers.append(
            WorkspaceBlocker(
                code="view_not_supported",
                severity="information",
                message=view.reason,
            )
        )
    if run.flags.budget_exceeded:
        blockers.append(
            WorkspaceBlocker(
                code="run_budget_exceeded",
                severity="blocking",
                message="The run exceeded its configured activity or model budget.",
            )
        )
    return blockers


def _allowed_actions(
    run: CountyRunState,
    *,
    role: WorkspaceRole,
    question: PlanningQuestion,
    blockers: list[WorkspaceBlocker],
) -> list[WorkspaceAction]:
    actions: list[WorkspaceAction] = ["inspect_evidence"]
    if role != "read_only":
        actions.append("export_draft")
    if question == "which_barriers_overlap" and role in {"analyst", "planner", "reviewer", "admin"}:
        actions.append("compare_barriers")
    if question == "how_plans_align" and role in {"analyst", "planner", "reviewer", "admin"}:
        actions.append("compare_plans")
    if question == "compare_scenarios" and role in {"planner", "reviewer", "admin"}:
        actions.append("create_scenario")
    if question == "which_funding_moves_next" and role in {"analyst", "planner", "reviewer", "admin"}:
        actions.append("inspect_funding")
    if any(item.severity == "review_required" for item in blockers) and role in {"analyst", "planner"}:
        actions.append("request_review")
    if any(item.severity == "blocking" for item in blockers) and role in {"reviewer", "admin"}:
        actions.append("review_conflicts")

    blocking_or_review = any(
        item.severity in {"blocking", "review_required"} for item in blockers
    )
    if (
        role in {"reviewer", "admin"}
        and run.flags.safe_to_publish
        and not run.flags.publication_approved
        and not blocking_or_review
    ):
        actions.append("approve_publication")
    return list(dict.fromkeys(actions))


def _publication_state(run: CountyRunState, blockers: list[WorkspaceBlocker]) -> str:
    if any(item.severity in {"blocking", "review_required"} for item in blockers):
        return "review_required"
    if run.flags.publication_approved:
        return "approved"
    if run.flags.safe_to_publish:
        return "safe_not_approved"
    return "not_ready"


def _authoritative_ids(graph: EvidenceGraphSnapshot) -> list[str]:
    node_ids = {
        node_id
        for edge in graph.authoritative_edges
        for node_id in (edge.from_node_id, edge.to_node_id)
    }
    return list(
        dict.fromkeys(
            node.entity_id
            for node in graph.nodes
            if node.id in node_ids and node.node_type not in {"geography", "source_version"}
        )
    )


def build_decision_workspace(request: DecisionWorkspaceRequest) -> DecisionWorkspaceContract:
    run = request.county_run
    if run.tenant_id is not None and request.actor_tenant_id != run.tenant_id:
        raise ValueError("workspace tenant does not match the authenticated actor tenant")

    graph = build_governed_evidence_graph(run)
    view_request = _planning_view_request(
        run,
        graph,
        question=request.question,
        mobile=request.mobile,
    )
    view = select_planning_view(view_request)
    blockers = _blockers(run, view, graph)
    actions = _allowed_actions(
        run,
        role=request.role,
        question=request.question,
        blockers=blockers,
    )
    return DecisionWorkspaceContract(
        run_id=run.run_id,
        tenant_id=run.tenant_id,
        county_id=run.county.id,
        county_name=run.county.display_name,
        role=request.role,
        question=request.question,
        evidence_status=_evidence_status(run),
        evidence_graph_status=graph.status,
        authoritative_relationship_count=len(graph.authoritative_edges),
        view=view,
        blockers=blockers,
        allowed_actions=actions,
        publication_state=_publication_state(run, blockers),
        authoritative_entity_ids=_authoritative_ids(graph),
    )

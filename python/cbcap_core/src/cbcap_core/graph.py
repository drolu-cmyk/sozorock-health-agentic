from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Any, Literal, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.types import RetryPolicy, interrupt
from pydantic import Field

from .barriers import classify_barrier_measures
from .evidence_adapter import select_county_public_evidence, select_county_source_coverage
from .gateway import SourceCoverageAssertion
from .models import (
    BarrierObservation,
    Conflict,
    CountyRunState,
    EvidenceClaim,
    Measure,
    Organization,
    PlanDocument,
    ReviewDecision,
    ReviewStatus,
    RunStatus,
    SourceDocument,
    StrictModel,
    WorkflowFlags,
)
from .planning_pipeline import PlanningPipelineRequest, run_planning_pipeline
from .workforce import (
    WorkforceDesignation,
    assess_hpsa_source_coverage,
    classify_workforce_measures,
)
from .workforce_capacity import WorkforceCapacityObservation, classify_ahrf_capacity_measures

BranchName = Literal["public_evidence", "planning_documents", "workforce_designations", "barrier_evidence"]
REQUIRED_BRANCHES: tuple[BranchName, ...] = (
    "public_evidence",
    "planning_documents",
    "workforce_designations",
    "barrier_evidence",
)


class RunBudget(StrictModel):
    max_model_tokens: int = Field(default=0, ge=0)
    max_model_cost_usd: float = Field(default=0.0, ge=0)
    max_external_calls: int = Field(default=100, ge=0)
    model_tokens_used: int = Field(default=0, ge=0)
    model_cost_usd: float = Field(default=0.0, ge=0)
    preflight_external_calls_used: int = Field(default=0, ge=0)
    external_calls_used: int = Field(default=0, ge=0)

    def exceeded(self) -> bool:
        return (
            self.model_tokens_used > self.max_model_tokens
            or self.model_cost_usd > self.max_model_cost_usd
            or max(self.external_calls_used, self.preflight_external_calls_used) > self.max_external_calls
        )


class BranchResult(StrictModel):
    id: str = Field(min_length=1)
    branch: BranchName
    complete: bool
    conflict: bool = False
    evidence_ids: list[str] = Field(default_factory=list)
    model_tokens_used: int = Field(default=0, ge=0)
    model_cost_usd: float = Field(default=0.0, ge=0)
    external_calls_used: int = Field(default=0, ge=0)


class BranchPayload(StrictModel):
    id: str = Field(min_length=1)
    branch: BranchName
    source_release_ids: list[str] = Field(default_factory=list)
    source_coverage_assertions: list[SourceCoverageAssertion] = Field(default_factory=list)
    source_documents: list[SourceDocument] = Field(default_factory=list)
    evidence_claims: list[EvidenceClaim] = Field(default_factory=list)
    measures: list[Measure] = Field(default_factory=list)
    barrier_observations: list[BarrierObservation] = Field(default_factory=list)
    workforce_designations: list[WorkforceDesignation] = Field(default_factory=list)
    workforce_capacity_observations: list[WorkforceCapacityObservation] = Field(default_factory=list)
    plan_documents: list[PlanDocument] = Field(default_factory=list)
    organizations: list[Organization] = Field(default_factory=list)

    def evidence_ids(self) -> list[str]:
        return [
            *[item.id for item in self.source_coverage_assertions],
            *[item.id for item in self.source_documents],
            *[item.id for item in self.evidence_claims],
            *[item.id for item in self.measures],
            *[item.id for item in self.barrier_observations],
            *[item.id for item in self.workforce_designations],
            *[item.id for item in self.workforce_capacity_observations],
            *[item.id for item in self.plan_documents],
            *[item.id for item in self.organizations],
        ]


class GraphAuditEvent(StrictModel):
    id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    node: str = Field(min_length=1)
    action: str = Field(min_length=1)
    occurred_at: datetime


def _merge_unique_records(existing, incoming):
    merged = {}
    for record in [*(existing or []), *(incoming or [])]:
        record_id = str(record.get("id", ""))
        if not record_id:
            raise ValueError("reduced graph records require a stable id")
        merged.setdefault(record_id, record)
    return list(merged.values())


class CountyGraphState(TypedDict, total=False):
    county_run: dict[str, Any]
    budget: dict[str, Any]
    branch_results: Annotated[list[dict[str, Any]], _merge_unique_records]
    branch_payloads: Annotated[list[dict[str, Any]], _merge_unique_records]
    audit_events: Annotated[list[dict[str, Any]], _merge_unique_records]
    trajectory_events: Annotated[list[dict[str, Any]], _merge_unique_records]
    review_outcome: str | None


@dataclass(frozen=True)
class CountyGraphContext:
    simulate_source_conflict: bool = False
    untrusted_source_text: str | None = None
    public_evidence_package: dict[str, Any] | None = None
    planning_pipeline_request: dict[str, Any] | None = None


def initial_graph_state(county_run: CountyRunState, *, budget: RunBudget | None = None) -> CountyGraphState:
    resolved_budget = budget or RunBudget()
    if resolved_budget.external_calls_used and not resolved_budget.preflight_external_calls_used:
        resolved_budget = RunBudget.model_validate({
            **resolved_budget.model_dump(mode="python"),
            "preflight_external_calls_used": resolved_budget.external_calls_used,
        })
    return {
        "county_run": county_run.model_dump(mode="json"),
        "budget": resolved_budget.model_dump(mode="json"),
        "branch_results": [],
        "branch_payloads": [],
        "audit_events": [],
        "trajectory_events": [],
        "review_outcome": None,
    }


def _load_run(state):
    return CountyRunState.model_validate(state["county_run"])


def _load_budget(state):
    return RunBudget.model_validate(state.get("budget", {}))


def _validated_run_copy(run, **updates):
    payload = run.model_dump(mode="python")
    payload.update(updates)
    return CountyRunState.model_validate(payload)


def _with_flags(run, **changes):
    flags_payload = run.flags.model_dump(mode="python")
    flags_payload.update(changes)
    return _validated_run_copy(run, flags=WorkflowFlags.model_validate(flags_payload))


def _dump_run(run):
    return run.model_dump(mode="json")


def _audit(run, node, action):
    return GraphAuditEvent(
        id=f"{run.run_id}:{node}:{action}",
        run_id=run.run_id,
        node=node,
        action=action,
        occurred_at=datetime.now(timezone.utc),
    ).model_dump(mode="json")


def _runtime_context(runtime):
    return runtime.context or CountyGraphContext()


def _merge_entities(existing, incoming):
    merged = {item.id: item for item in existing}
    for item in incoming:
        merged[item.id] = item
    return list(merged.values())


def _trajectory_event(run, *, stage, entity_id, outcome, reason_codes=None):
    reason_codes = reason_codes or []
    reason_key = ":".join(sorted(reason_codes)) or "none"
    return {
        "id": f"{run.run_id}:{stage}:{entity_id}:{outcome}:{reason_key}",
        "run_id": run.run_id,
        "stage": stage,
        "entity_id": entity_id,
        "outcome": outcome,
        "reason_codes": sorted(set(reason_codes)),
        "occurred_at": datetime.now(timezone.utc).isoformat(),
    }


def resolve_geography(state):
    run = _load_run(state)
    verified = run.county.review_status == ReviewStatus.VERIFIED
    run = _with_flags(run, geography_verified=verified)
    return {"county_run": _dump_run(run), "audit_events": [_audit(run, "resolve_geography", "verified" if verified else "unverified")]}


def establish_run_state(state):
    run = _load_run(state)
    status = RunStatus.CANCELLED if run.flags.cancel_requested else RunStatus.RUNNING
    run = _validated_run_copy(run, status=status)
    return {"county_run": _dump_run(run), "audit_events": [_audit(run, "establish_run_state", status.value)]}


def route_after_establish(state):
    return "cancelled" if _load_run(state).flags.cancel_requested else list(REQUIRED_BRANCHES)


def _existing_payload(run, branch):
    if branch == "public_evidence":
        return BranchPayload(id=f"{run.run_id}:payload:{branch}", branch=branch, measures=list(run.measures))
    if branch == "planning_documents":
        return BranchPayload(
            id=f"{run.run_id}:payload:{branch}",
            branch=branch,
            source_documents=list(run.source_documents),
            evidence_claims=list(run.evidence_claims),
            plan_documents=list(run.plan_documents),
        )
    if branch == "workforce_designations":
        return BranchPayload(
            id=f"{run.run_id}:payload:{branch}",
            branch=branch,
            measures=[item for item in run.measures if item.source_version.source_id in {"hrsa-workforce", "ahrf-workforce"}],
        )
    if branch == "barrier_evidence":
        return BranchPayload(id=f"{run.run_id}:payload:{branch}", branch=branch, barrier_observations=list(run.barrier_observations))
    raise ValueError(f"unknown branch: {branch}")


def _branch_output(run, payload, *, conflict=False, complete_override=None, trajectory_events=None):
    evidence_ids = payload.evidence_ids()
    complete = bool(evidence_ids) if complete_override is None else bool(complete_override and evidence_ids)
    result = BranchResult(
        id=f"{run.run_id}:branch:{payload.branch}",
        branch=payload.branch,
        complete=complete,
        conflict=conflict,
        evidence_ids=evidence_ids,
    )
    action = "completed" if result.complete else "missing_evidence"
    return {
        "branch_results": [result.model_dump(mode="json")],
        "branch_payloads": [payload.model_dump(mode="json")],
        "audit_events": [_audit(run, payload.branch, action)],
        "trajectory_events": trajectory_events or [],
    }


def public_evidence_branch(state, runtime):
    run = _load_run(state)
    context = _runtime_context(runtime)
    _ = context.untrusted_source_text
    if context.public_evidence_package is None:
        payload = _existing_payload(run, "public_evidence")
    else:
        measures, release_id = select_county_public_evidence(run, context.public_evidence_package)
        payload = BranchPayload(
            id=f"{run.run_id}:payload:public_evidence",
            branch="public_evidence",
            source_release_ids=[release_id],
            measures=measures,
        )
    return _branch_output(run, payload)


def planning_documents_branch(state, runtime):
    run = _load_run(state)
    context = _runtime_context(runtime)
    if context.planning_pipeline_request is None:
        payload = _existing_payload(run, "planning_documents")
        return _branch_output(run, payload, conflict=context.simulate_source_conflict)

    request = PlanningPipelineRequest.model_validate(context.planning_pipeline_request)
    request_county = request.research.county
    if request_county.county_fips != run.county.county_fips:
        payload = BranchPayload(id=f"{run.run_id}:payload:planning_documents", branch="planning_documents")
        return _branch_output(
            run,
            payload,
            complete_override=False,
            trajectory_events=[
                _trajectory_event(
                    run,
                    stage="candidate_policy",
                    entity_id=request_county.id,
                    outcome="rejected",
                    reason_codes=["planning_request_geography_mismatch"],
                )
            ],
        )

    pipeline_result = run_planning_pipeline(request)
    payload = BranchPayload(
        id=f"{run.run_id}:payload:planning_documents",
        branch="planning_documents",
        source_documents=pipeline_result.admitted_source_documents,
        evidence_claims=pipeline_result.admitted_claims,
        plan_documents=pipeline_result.admitted_plan_documents,
    )
    return _branch_output(
        run,
        payload,
        conflict=context.simulate_source_conflict,
        complete_override=pipeline_result.ready_for_county_graph,
        trajectory_events=[item.model_dump(mode="json") for item in pipeline_result.trajectory],
    )


def workforce_designations_branch(state, runtime):
    run = _load_run(state)
    context = _runtime_context(runtime)
    _ = context.untrusted_source_text

    if context.public_evidence_package is None:
        measures = [
            item
            for item in run.measures
            if item.source_version.source_id in {"hrsa-workforce", "ahrf-workforce"}
        ]
        coverage_assertions: list[SourceCoverageAssertion] = []
        release_ids: list[str] = []
    else:
        measures, release_id = select_county_public_evidence(run, context.public_evidence_package)
        coverage_assertions, coverage_release_id = select_county_source_coverage(
            run,
            context.public_evidence_package,
        )
        if coverage_release_id != release_id:
            raise ValueError("public evidence and source coverage release IDs do not match")
        release_ids = [release_id]

    hrsa_measures = [item for item in measures if item.source_version.source_id == "hrsa-workforce"]
    ahrf_measures = [item for item in measures if item.source_version.source_id == "ahrf-workforce"]
    classification = classify_workforce_measures(hrsa_measures)
    capacity = classify_ahrf_capacity_measures(ahrf_measures)
    coverage = assess_hpsa_source_coverage(coverage_assertions, classification.designations)

    payload = BranchPayload(
        id=f"{run.run_id}:payload:workforce_designations",
        branch="workforce_designations",
        source_release_ids=release_ids,
        source_coverage_assertions=[
            item for item in coverage_assertions if item.source_id == "hrsa-workforce"
        ],
        measures=[*hrsa_measures, *ahrf_measures],
        barrier_observations=classification.county_barrier_observations,
        workforce_designations=classification.designations,
        workforce_capacity_observations=capacity.observations,
    )

    trajectory = [
        _trajectory_event(
            run,
            stage="workforce_classification",
            entity_id=decision.measure_id,
            outcome=decision.status,
            reason_codes=decision.reason_codes,
        )
        for decision in classification.decisions
    ]
    trajectory.extend(
        _trajectory_event(
            run,
            stage="workforce_capacity",
            entity_id=decision.measure_id,
            outcome=decision.status,
            reason_codes=decision.reason_codes,
        )
        for decision in capacity.decisions
    )
    for designation in classification.designations:
        trajectory.append(
            _trajectory_event(
                run,
                stage="workforce_scope",
                entity_id=designation.id,
                outcome="county_shortage" if designation.is_whole_county else "scoped_context",
                reason_codes=[f"scope_{designation.scope}", f"discipline_{designation.discipline}"],
            )
        )
    coverage_outcome = (
        "complete_no_designations"
        if coverage.complete and coverage.no_designations_reported
        else "complete"
        if coverage.complete
        else "incomplete"
    )
    trajectory.append(
        _trajectory_event(
            run,
            stage="workforce_source_coverage",
            entity_id=run.county.id,
            outcome=coverage_outcome,
            reason_codes=coverage.problem_codes,
        )
    )
    classification_complete = all(
        decision.status == "admitted" for decision in classification.decisions
    )
    return _branch_output(
        run,
        payload,
        complete_override=coverage.complete and classification_complete,
        trajectory_events=trajectory,
    )


def barrier_evidence_branch(state, runtime):
    run = _load_run(state)
    context = _runtime_context(runtime)
    _ = context.untrusted_source_text
    if context.public_evidence_package is None:
        return _branch_output(run, _existing_payload(run, "barrier_evidence"))

    measures, release_id = select_county_public_evidence(run, context.public_evidence_package)
    classification = classify_barrier_measures(measures)
    payload = BranchPayload(
        id=f"{run.run_id}:payload:barrier_evidence",
        branch="barrier_evidence",
        source_release_ids=[release_id],
        barrier_observations=classification.observations,
    )
    trajectory = [
        _trajectory_event(
            run,
            stage="barrier_classification",
            entity_id=decision.measure_id,
            outcome=decision.status,
            reason_codes=decision.reason_codes,
        )
        for decision in classification.decisions
    ]
    return _branch_output(
        run,
        payload,
        complete_override=bool(classification.observations),
        trajectory_events=trajectory,
    )


def _merge_branch_payloads(run, payloads):
    source_documents = list(run.source_documents)
    evidence_claims = list(run.evidence_claims)
    measures = list(run.measures)
    barrier_observations = list(run.barrier_observations)
    plan_documents = list(run.plan_documents)
    organizations = list(run.organizations)
    for payload in payloads:
        source_documents = _merge_entities(source_documents, payload.source_documents)
        evidence_claims = _merge_entities(evidence_claims, payload.evidence_claims)
        measures = _merge_entities(measures, payload.measures)
        barrier_observations = _merge_entities(barrier_observations, payload.barrier_observations)
        plan_documents = _merge_entities(plan_documents, payload.plan_documents)
        organizations = _merge_entities(organizations, payload.organizations)
    return _validated_run_copy(
        run,
        source_documents=source_documents,
        evidence_claims=evidence_claims,
        measures=measures,
        barrier_observations=barrier_observations,
        plan_documents=plan_documents,
        organizations=organizations,
    )


def validate_join(state):
    run = _load_run(state)
    results = [BranchResult.model_validate(item) for item in state.get("branch_results", [])]
    payloads = [BranchPayload.model_validate(item) for item in state.get("branch_payloads", [])]
    by_branch = {result.branch: result for result in results}
    all_present = all(branch in by_branch for branch in REQUIRED_BRANCHES)
    all_complete = all_present and all(by_branch[branch].complete for branch in REQUIRED_BRANCHES)
    has_conflict = any(result.conflict for result in results)
    run = _merge_branch_payloads(run, payloads)
    conflicts = list(run.conflicts)
    conflict_id = f"{run.run_id}:source-conflict"
    if has_conflict and not any(item.id == conflict_id for item in conflicts):
        conflicts.append(Conflict(
            id=conflict_id,
            geography_id=run.county.id,
            entity_type="evidence",
            entity_ids=["branch:public_evidence", "branch:planning_documents"],
            conflict_type="source_disagreement",
            summary="Parallel evidence branches produced a source disagreement requiring review.",
            blocking=True,
            review_status=ReviewStatus.PROVISIONAL,
        ))
    budget = _load_budget(state)
    budget = RunBudget.model_validate({
        **budget.model_dump(mode="python"),
        "model_tokens_used": sum(item.model_tokens_used for item in results),
        "model_cost_usd": sum(item.model_cost_usd for item in results),
        "external_calls_used": budget.preflight_external_calls_used + sum(
            item.external_calls_used for item in results
        ),
    })
    run = _validated_run_copy(run, conflicts=conflicts)
    run = _with_flags(
        run,
        required_sources_complete=all_complete,
        evidence_validated=all_complete,
        source_conflict=has_conflict,
        blocking_conflict=has_conflict,
        needs_human_review=has_conflict,
    )
    return {
        "county_run": _dump_run(run),
        "budget": budget.model_dump(mode="json"),
        "audit_events": [_audit(run, "validate_join", "validated" if all_complete else "incomplete")],
    }


def policy_gate(state):
    run = _load_run(state)
    budget = _load_budget(state)
    budget_exceeded = budget.exceeded()
    policy_passed = (
        run.flags.geography_verified
        and run.flags.required_sources_complete
        and run.flags.evidence_validated
        and not budget_exceeded
        and not run.flags.cancel_requested
    )
    run = _with_flags(run, budget_exceeded=budget_exceeded, policy_passed=policy_passed)
    return {"county_run": _dump_run(run), "audit_events": [_audit(run, "policy_gate", "passed" if policy_passed else "blocked")]}


def route_after_policy(state):
    run = _load_run(state)
    if run.flags.cancel_requested:
        return "cancelled"
    if run.flags.budget_exceeded or not run.flags.policy_passed:
        return "blocked"
    if run.flags.needs_human_review or run.flags.source_conflict or run.flags.blocking_conflict:
        return "mark_review"
    return "finalize"


def mark_review(state):
    run = _validated_run_copy(_load_run(state), status=RunStatus.WAITING_REVIEW)
    return {"county_run": _dump_run(run), "audit_events": [_audit(run, "mark_review", "waiting")]}


def human_review(state):
    run = _load_run(state)
    response = interrupt({
        "type": "cbcap_human_review",
        "run_id": run.run_id,
        "county": run.county.display_name,
        "conflict_ids": [item.id for item in run.conflicts if item.blocking],
        "allowed_decisions": ["approved", "rejected", "needs_revision", "deferred"],
    })
    if not isinstance(response, dict):
        raise ValueError("review resume payload must be an object")
    decision_value = str(response.get("decision", ""))
    if decision_value not in {"approved", "rejected", "needs_revision", "deferred"}:
        raise ValueError("invalid review decision")
    reviewer = str(response.get("reviewer", "")).strip()
    reason = str(response.get("reason", "")).strip()
    if not reviewer or not reason:
        raise ValueError("reviewer and reason are required")
    decision = ReviewDecision(
        id=f"{run.run_id}:review:{len(run.reviews) + 1}",
        tenant_id=run.tenant_id,
        entity_type="county_run",
        entity_id=run.run_id,
        decision=decision_value,
        decided_by=reviewer,
        decided_at=datetime.now(timezone.utc),
        reason=reason,
    )
    approved = decision_value == "approved"
    conflicts = list(run.conflicts)
    if approved:
        conflicts = [Conflict.model_validate({
            **item.model_dump(mode="python"),
            "blocking": False if item.blocking else item.blocking,
            "review_status": ReviewStatus.VERIFIED if item.blocking else item.review_status,
        }) for item in conflicts]
    run = _validated_run_copy(
        run,
        reviews=[*run.reviews, decision],
        conflicts=conflicts,
        status=RunStatus.RUNNING if approved else RunStatus.BLOCKED,
    )
    run = _with_flags(
        run,
        source_conflict=False if approved else run.flags.source_conflict,
        blocking_conflict=False if approved else run.flags.blocking_conflict,
        needs_human_review=False,
        review_complete=True,
        policy_passed=run.flags.policy_passed if approved else False,
    )
    return {"county_run": _dump_run(run), "review_outcome": decision_value, "audit_events": [_audit(run, "human_review", decision_value)]}


def route_after_review(state):
    return "finalize" if state.get("review_outcome") == "approved" else "blocked"


def finalize(state):
    run = _load_run(state)
    flags_payload = run.flags.model_dump(mode="python")
    flags_payload["safe_to_publish"] = run.flags.publication_preconditions_met()
    flags = WorkflowFlags.model_validate(flags_payload)
    status = RunStatus.COMPLETED if flags.safe_to_publish else RunStatus.BLOCKED
    run = _validated_run_copy(run, flags=flags, status=status)
    return {"county_run": _dump_run(run), "audit_events": [_audit(run, "finalize", status.value)]}


def blocked(state):
    run = _with_flags(_load_run(state), safe_to_publish=False)
    run = _validated_run_copy(run, status=RunStatus.BLOCKED)
    return {"county_run": _dump_run(run), "audit_events": [_audit(run, "blocked", "blocked")]}


def cancelled(state):
    run = _with_flags(_load_run(state), safe_to_publish=False, policy_passed=False)
    run = _validated_run_copy(run, status=RunStatus.CANCELLED)
    return {"county_run": _dump_run(run), "audit_events": [_audit(run, "cancelled", "cancelled")]}


def build_county_planning_graph(*, checkpointer: Any | None = None):
    retry_policy = RetryPolicy(max_attempts=3)
    builder = StateGraph(CountyGraphState, context_schema=CountyGraphContext)
    builder.add_node("resolve_geography", resolve_geography)
    builder.add_node("establish_run_state", establish_run_state)
    builder.add_node("public_evidence", public_evidence_branch, retry_policy=retry_policy)
    builder.add_node("planning_documents", planning_documents_branch, retry_policy=retry_policy)
    builder.add_node("workforce_designations", workforce_designations_branch, retry_policy=retry_policy)
    builder.add_node("barrier_evidence", barrier_evidence_branch, retry_policy=retry_policy)
    builder.add_node("validate_join", validate_join)
    builder.add_node("policy_gate", policy_gate)
    builder.add_node("mark_review", mark_review)
    builder.add_node("human_review", human_review)
    builder.add_node("finalize", finalize)
    builder.add_node("blocked", blocked)
    builder.add_node("cancelled", cancelled)
    builder.add_edge(START, "resolve_geography")
    builder.add_edge("resolve_geography", "establish_run_state")
    builder.add_conditional_edges("establish_run_state", route_after_establish, {
        "public_evidence": "public_evidence",
        "planning_documents": "planning_documents",
        "workforce_designations": "workforce_designations",
        "barrier_evidence": "barrier_evidence",
        "cancelled": "cancelled",
    })
    builder.add_edge(list(REQUIRED_BRANCHES), "validate_join")
    builder.add_edge("validate_join", "policy_gate")
    builder.add_conditional_edges("policy_gate", route_after_policy, {
        "mark_review": "mark_review",
        "finalize": "finalize",
        "blocked": "blocked",
        "cancelled": "cancelled",
    })
    builder.add_edge("mark_review", "human_review")
    builder.add_conditional_edges("human_review", route_after_review, {"finalize": "finalize", "blocked": "blocked"})
    builder.add_edge("finalize", END)
    builder.add_edge("blocked", END)
    builder.add_edge("cancelled", END)
    return builder.compile(checkpointer=checkpointer or InMemorySaver())

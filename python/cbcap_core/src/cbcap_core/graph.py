from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Annotated, Any, Literal, TypedDict

from langgraph.checkpoint.memory import InMemorySaver
from langgraph.graph import END, START, StateGraph
from langgraph.runtime import Runtime
from langgraph.types import RetryPolicy, interrupt
from pydantic import Field

from .models import (
    Conflict,
    CountyRunState,
    ReviewDecision,
    ReviewStatus,
    RunStatus,
    StrictModel,
    WorkflowFlags,
)


BranchName = Literal[
    "public_evidence",
    "planning_documents",
    "workforce_designations",
    "barrier_evidence",
]

REQUIRED_BRANCHES: tuple[BranchName, ...] = (
    "public_evidence",
    "planning_documents",
    "workforce_designations",
    "barrier_evidence",
)


class RunBudget(StrictModel):
    """Run-level cost and activity budget independent of any model provider."""

    max_model_tokens: int = Field(default=0, ge=0)
    max_model_cost_usd: float = Field(default=0.0, ge=0)
    max_external_calls: int = Field(default=100, ge=0)
    model_tokens_used: int = Field(default=0, ge=0)
    model_cost_usd: float = Field(default=0.0, ge=0)
    external_calls_used: int = Field(default=0, ge=0)

    def exceeded(self) -> bool:
        return (
            self.model_tokens_used > self.max_model_tokens
            or self.model_cost_usd > self.max_model_cost_usd
            or self.external_calls_used > self.max_external_calls
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


class GraphAuditEvent(StrictModel):
    id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    node: str = Field(min_length=1)
    action: str = Field(min_length=1)
    occurred_at: datetime


def _merge_unique_records(
    existing: list[dict[str, Any]] | None,
    incoming: list[dict[str, Any]] | None,
) -> list[dict[str, Any]]:
    """Replay-safe reducer keyed by stable record id."""

    merged: dict[str, dict[str, Any]] = {}
    for record in [*(existing or []), *(incoming or [])]:
        record_id = str(record.get("id", ""))
        if not record_id:
            raise ValueError("reduced graph records require a stable id")
        merged.setdefault(record_id, record)
    return list(merged.values())


class CountyGraphState(TypedDict, total=False):
    """Operational graph envelope around canonical CountyRunState."""

    county_run: dict[str, Any]
    budget: dict[str, Any]
    branch_results: Annotated[list[dict[str, Any]], _merge_unique_records]
    audit_events: Annotated[list[dict[str, Any]], _merge_unique_records]
    review_outcome: str | None


@dataclass(frozen=True)
class CountyGraphContext:
    """Immutable runtime context. External prose is never graph control state."""

    simulate_source_conflict: bool = False
    untrusted_source_text: str | None = None


def initial_graph_state(
    county_run: CountyRunState,
    *,
    budget: RunBudget | None = None,
) -> CountyGraphState:
    return {
        "county_run": county_run.model_dump(mode="json"),
        "budget": (budget or RunBudget()).model_dump(mode="json"),
        "branch_results": [],
        "audit_events": [],
        "review_outcome": None,
    }


def _load_run(state: CountyGraphState) -> CountyRunState:
    return CountyRunState.model_validate(state["county_run"])


def _load_budget(state: CountyGraphState) -> RunBudget:
    return RunBudget.model_validate(state.get("budget", {}))


def _validated_run_copy(run: CountyRunState, **updates: Any) -> CountyRunState:
    payload = run.model_dump(mode="python")
    payload.update(updates)
    return CountyRunState.model_validate(payload)


def _with_flags(run: CountyRunState, **changes: Any) -> CountyRunState:
    flags_payload = run.flags.model_dump(mode="python")
    flags_payload.update(changes)
    flags = WorkflowFlags.model_validate(flags_payload)
    return _validated_run_copy(run, flags=flags)


def _dump_run(run: CountyRunState) -> dict[str, Any]:
    return run.model_dump(mode="json")


def _audit(run: CountyRunState, node: str, action: str) -> dict[str, Any]:
    event = GraphAuditEvent(
        id=f"{run.run_id}:{node}:{action}",
        run_id=run.run_id,
        node=node,
        action=action,
        occurred_at=datetime.now(timezone.utc),
    )
    return event.model_dump(mode="json")


def _runtime_context(runtime: Runtime[CountyGraphContext]) -> CountyGraphContext:
    return runtime.context or CountyGraphContext()


def resolve_geography(state: CountyGraphState) -> CountyGraphState:
    run = _load_run(state)
    verified = run.county.review_status == ReviewStatus.VERIFIED
    run = _with_flags(run, geography_verified=verified)
    return {
        "county_run": _dump_run(run),
        "audit_events": [_audit(run, "resolve_geography", "verified" if verified else "unverified")],
    }


def establish_run_state(state: CountyGraphState) -> CountyGraphState:
    run = _load_run(state)
    status = RunStatus.CANCELLED if run.flags.cancel_requested else RunStatus.RUNNING
    run = _validated_run_copy(run, status=status)
    return {
        "county_run": _dump_run(run),
        "audit_events": [_audit(run, "establish_run_state", status.value)],
    }


def route_after_establish(
    state: CountyGraphState,
) -> list[BranchName] | Literal["cancelled"]:
    run = _load_run(state)
    if run.flags.cancel_requested:
        return "cancelled"
    return list(REQUIRED_BRANCHES)


def _evidence_ids_for_branch(run: CountyRunState, branch: BranchName) -> list[str]:
    """Return authoritative typed evidence available to a research branch.

    Phase 3 is intentionally code-first. Later adapters and specialist subgraphs
    will hydrate these collections. Branches cannot declare success from prose,
    prompts, or an empty result.
    """

    if branch == "public_evidence":
        return [item.id for item in run.measures]
    if branch == "planning_documents":
        return [item.id for item in run.plan_documents]
    if branch == "workforce_designations":
        return [
            item.id
            for item in run.measures
            if item.source_version.source_id.startswith(("hrsa", "ahrf"))
        ]
    if branch == "barrier_evidence":
        return [item.id for item in run.barrier_observations]
    raise ValueError(f"unknown branch: {branch}")


def _branch_result(
    state: CountyGraphState,
    branch: BranchName,
    *,
    conflict: bool = False,
) -> CountyGraphState:
    run = _load_run(state)
    evidence_ids = _evidence_ids_for_branch(run, branch)
    result = BranchResult(
        id=f"{run.run_id}:branch:{branch}",
        branch=branch,
        complete=bool(evidence_ids),
        conflict=conflict,
        evidence_ids=evidence_ids,
        model_tokens_used=0,
        model_cost_usd=0,
        external_calls_used=0,
    )
    action = "completed" if result.complete else "missing_evidence"
    return {
        "branch_results": [result.model_dump(mode="json")],
        "audit_events": [_audit(run, branch, action)],
    }


def public_evidence_branch(
    state: CountyGraphState,
    runtime: Runtime[CountyGraphContext],
) -> CountyGraphState:
    _ = _runtime_context(runtime).untrusted_source_text
    return _branch_result(state, "public_evidence")


def planning_documents_branch(
    state: CountyGraphState,
    runtime: Runtime[CountyGraphContext],
) -> CountyGraphState:
    return _branch_result(
        state,
        "planning_documents",
        conflict=_runtime_context(runtime).simulate_source_conflict,
    )


def workforce_designations_branch(
    state: CountyGraphState,
    runtime: Runtime[CountyGraphContext],
) -> CountyGraphState:
    _ = _runtime_context(runtime).untrusted_source_text
    return _branch_result(state, "workforce_designations")


def barrier_evidence_branch(
    state: CountyGraphState,
    runtime: Runtime[CountyGraphContext],
) -> CountyGraphState:
    _ = _runtime_context(runtime).untrusted_source_text
    return _branch_result(state, "barrier_evidence")


def validate_join(state: CountyGraphState) -> CountyGraphState:
    run = _load_run(state)
    results = [BranchResult.model_validate(item) for item in state.get("branch_results", [])]
    by_branch = {result.branch: result for result in results}
    all_present = all(branch in by_branch for branch in REQUIRED_BRANCHES)
    all_complete = all_present and all(by_branch[branch].complete for branch in REQUIRED_BRANCHES)
    has_conflict = any(result.conflict for result in results)

    conflicts = list(run.conflicts)
    conflict_id = f"{run.run_id}:source-conflict"
    if has_conflict and not any(item.id == conflict_id for item in conflicts):
        conflicts.append(
            Conflict(
                id=conflict_id,
                geography_id=run.county.id,
                entity_type="evidence",
                entity_ids=["branch:public_evidence", "branch:planning_documents"],
                conflict_type="source_disagreement",
                summary="Parallel evidence branches produced a source disagreement requiring review.",
                blocking=True,
                review_status=ReviewStatus.PROVISIONAL,
            )
        )

    budget = _load_budget(state)
    budget = RunBudget.model_validate(
        {
            **budget.model_dump(mode="python"),
            "model_tokens_used": sum(item.model_tokens_used for item in results),
            "model_cost_usd": sum(item.model_cost_usd for item in results),
            "external_calls_used": sum(item.external_calls_used for item in results),
        }
    )

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


def policy_gate(state: CountyGraphState) -> CountyGraphState:
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
    run = _with_flags(
        run,
        budget_exceeded=budget_exceeded,
        policy_passed=policy_passed,
    )
    return {
        "county_run": _dump_run(run),
        "audit_events": [_audit(run, "policy_gate", "passed" if policy_passed else "blocked")],
    }


def route_after_policy(
    state: CountyGraphState,
) -> Literal["mark_review", "finalize", "blocked", "cancelled"]:
    run = _load_run(state)
    if run.flags.cancel_requested:
        return "cancelled"
    if run.flags.budget_exceeded or not run.flags.policy_passed:
        return "blocked"
    if run.flags.needs_human_review or run.flags.source_conflict or run.flags.blocking_conflict:
        return "mark_review"
    return "finalize"


def mark_review(state: CountyGraphState) -> CountyGraphState:
    run = _load_run(state)
    run = _validated_run_copy(run, status=RunStatus.WAITING_REVIEW)
    return {
        "county_run": _dump_run(run),
        "audit_events": [_audit(run, "mark_review", "waiting")],
    }


def human_review(state: CountyGraphState) -> CountyGraphState:
    run = _load_run(state)
    response = interrupt(
        {
            "type": "cbcap_human_review",
            "run_id": run.run_id,
            "county": run.county.display_name,
            "conflict_ids": [item.id for item in run.conflicts if item.blocking],
            "allowed_decisions": ["approved", "rejected", "needs_revision", "deferred"],
        }
    )
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
        conflicts = [
            Conflict.model_validate(
                {
                    **item.model_dump(mode="python"),
                    "blocking": False if item.blocking else item.blocking,
                    "review_status": ReviewStatus.VERIFIED if item.blocking else item.review_status,
                }
            )
            for item in conflicts
        ]

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
    return {
        "county_run": _dump_run(run),
        "review_outcome": decision_value,
        "audit_events": [_audit(run, "human_review", decision_value)],
    }


def route_after_review(state: CountyGraphState) -> Literal["finalize", "blocked"]:
    return "finalize" if state.get("review_outcome") == "approved" else "blocked"


def finalize(state: CountyGraphState) -> CountyGraphState:
    run = _load_run(state)
    flags_payload = run.flags.model_dump(mode="python")
    flags_payload["safe_to_publish"] = run.flags.publication_preconditions_met()
    flags = WorkflowFlags.model_validate(flags_payload)
    status = RunStatus.COMPLETED if flags.safe_to_publish else RunStatus.BLOCKED
    run = _validated_run_copy(run, flags=flags, status=status)
    return {
        "county_run": _dump_run(run),
        "audit_events": [_audit(run, "finalize", status.value)],
    }


def blocked(state: CountyGraphState) -> CountyGraphState:
    run = _load_run(state)
    run = _with_flags(run, safe_to_publish=False)
    run = _validated_run_copy(run, status=RunStatus.BLOCKED)
    return {
        "county_run": _dump_run(run),
        "audit_events": [_audit(run, "blocked", "blocked")],
    }


def cancelled(state: CountyGraphState) -> CountyGraphState:
    run = _load_run(state)
    run = _with_flags(run, safe_to_publish=False, policy_passed=False)
    run = _validated_run_copy(run, status=RunStatus.CANCELLED)
    return {
        "county_run": _dump_run(run),
        "audit_events": [_audit(run, "cancelled", "cancelled")],
    }


def build_county_planning_graph(*, checkpointer: Any | None = None):
    """Compile the first CB-CAP County Planning Graph.

    The default in-memory saver is only for tests and local development.
    Production must inject a durable checkpointer, initially Postgres-backed.
    """

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
    builder.add_conditional_edges(
        "establish_run_state",
        route_after_establish,
        {
            "public_evidence": "public_evidence",
            "planning_documents": "planning_documents",
            "workforce_designations": "workforce_designations",
            "barrier_evidence": "barrier_evidence",
            "cancelled": "cancelled",
        },
    )
    builder.add_edge(list(REQUIRED_BRANCHES), "validate_join")
    builder.add_edge("validate_join", "policy_gate")
    builder.add_conditional_edges(
        "policy_gate",
        route_after_policy,
        {
            "mark_review": "mark_review",
            "finalize": "finalize",
            "blocked": "blocked",
            "cancelled": "cancelled",
        },
    )
    builder.add_edge("mark_review", "human_review")
    builder.add_conditional_edges(
        "human_review",
        route_after_review,
        {"finalize": "finalize", "blocked": "blocked"},
    )
    builder.add_edge("finalize", END)
    builder.add_edge("blocked", END)
    builder.add_edge("cancelled", END)

    return builder.compile(checkpointer=checkpointer or InMemorySaver())

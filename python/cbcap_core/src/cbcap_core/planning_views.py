from __future__ import annotations

from typing import Literal

from pydantic import Field

from .models import StrictModel


PlanningQuestion = Literal[
    "which_barriers_overlap",
    "how_plans_align",
    "what_changed",
    "compare_scenarios",
    "which_funding_moves_next",
    "how_implementation_is_progressing",
    "how_entities_are_connected",
]
PlanningViewKind = Literal[
    "barrier_matrix",
    "plan_alignment_matrix",
    "evidence_timeline",
    "scenario_comparison",
    "funding_pipeline",
    "implementation_timeline",
    "relationship_graph",
]
PlanningViewStatus = Literal["ready", "blocked"]


class PlanningViewRequest(StrictModel):
    question: PlanningQuestion
    barrier_count: int = Field(default=0, ge=0)
    plan_count: int = Field(default=0, ge=0)
    evidence_events: int = Field(default=0, ge=0)
    scenario_count: int = Field(default=0, ge=0)
    funding_opportunity_count: int = Field(default=0, ge=0)
    implementation_item_count: int = Field(default=0, ge=0)
    relationship_node_count: int = Field(default=0, ge=0)
    relationship_edge_count: int = Field(default=0, ge=0)
    has_verified_lineage: bool = False
    has_time_semantics: bool = False
    mobile: bool = False


class PlanningViewDecision(StrictModel):
    status: PlanningViewStatus
    kind: PlanningViewKind | None = None
    reason: str = Field(min_length=1)
    caveats: list[str] = Field(default_factory=list)
    accessible_alternative: Literal[
        "matrix_table",
        "chronological_table",
        "scenario_table",
        "pipeline_table",
        "implementation_table",
        "relationship_table",
    ]
    mobile_sibling: PlanningViewKind | Literal["stacked_list"] | None = None


def _blocked(reason: str, fallback: PlanningViewDecision["accessible_alternative"] if False else str):
    return PlanningViewDecision(
        status="blocked",
        reason=reason,
        accessible_alternative=fallback,
    )


def select_planning_view(request: PlanningViewRequest) -> PlanningViewDecision:
    """Choose a planning workspace view from the decision question and evidence shape.

    This selector does not inspect prose or use a model. It only authorizes views
    when the underlying planning objects can support their visual claim.
    """

    if request.question == "which_barriers_overlap":
        if request.barrier_count < 2:
            return _blocked("Barrier overlap requires at least two admitted barrier observations.", "matrix_table")
        return PlanningViewDecision(
            status="ready",
            kind="barrier_matrix",
            reason="The question is pairwise co-occurrence among admitted barrier families.",
            caveats=["Co-occurrence must not be described as causation."],
            accessible_alternative="matrix_table",
            mobile_sibling="stacked_list" if request.mobile else "barrier_matrix",
        )

    if request.question == "how_plans_align":
        if request.plan_count < 2:
            return _blocked("Plan alignment requires at least two verified planning documents.", "matrix_table")
        if not request.has_verified_lineage:
            return _blocked("Plan alignment is blocked until plan evidence lineage is verified.", "matrix_table")
        return PlanningViewDecision(
            status="ready",
            kind="plan_alignment_matrix",
            reason="The question compares priorities and commitments across multiple verified plans.",
            caveats=["Agreement and disagreement must remain traceable to source claims."],
            accessible_alternative="matrix_table",
            mobile_sibling="stacked_list" if request.mobile else "plan_alignment_matrix",
        )

    if request.question == "what_changed":
        if request.evidence_events < 2:
            return _blocked("A change timeline requires at least two evidence events.", "chronological_table")
        if not request.has_time_semantics:
            return _blocked("A change timeline requires explicit event or evidence dates.", "chronological_table")
        return PlanningViewDecision(
            status="ready",
            kind="evidence_timeline",
            reason="The decision depends on chronological changes in verified evidence or plans.",
            caveats=["Do not imply continuous change between discrete observations."],
            accessible_alternative="chronological_table",
            mobile_sibling="evidence_timeline",
        )

    if request.question == "compare_scenarios":
        if request.scenario_count < 2:
            return _blocked("Scenario comparison requires at least two explicit scenarios.", "scenario_table")
        return PlanningViewDecision(
            status="ready",
            kind="scenario_comparison",
            reason="The question compares explicit assumptions and projected planning outcomes.",
            caveats=["Observed values, baseline projections and scenario projections must remain visually distinct."],
            accessible_alternative="scenario_table",
            mobile_sibling="stacked_list" if request.mobile else "scenario_comparison",
        )

    if request.question == "which_funding_moves_next":
        if request.funding_opportunity_count < 1:
            return _blocked("Funding pipeline requires at least one verified opportunity or fit record.", "pipeline_table")
        if not request.has_verified_lineage:
            return _blocked("Funding pipeline is blocked until opportunity lineage and requirements are verified.", "pipeline_table")
        return PlanningViewDecision(
            status="ready",
            kind="funding_pipeline",
            reason="The question is about funding stage, fit, evidence readiness and next action.",
            caveats=["Pipeline position must not be presented as an award probability unless a validated probability model exists."],
            accessible_alternative="pipeline_table",
            mobile_sibling="stacked_list" if request.mobile else "funding_pipeline",
        )

    if request.question == "how_implementation_is_progressing":
        if request.implementation_item_count < 1:
            return _blocked("Implementation timeline requires at least one dated implementation item.", "implementation_table")
        if not request.has_time_semantics:
            return _blocked("Implementation timeline requires explicit dates or planning periods.", "implementation_table")
        return PlanningViewDecision(
            status="ready",
            kind="implementation_timeline",
            reason="The question concerns planned work, milestones and implementation status over time.",
            caveats=["Do not infer completion from elapsed time; use explicit status evidence."],
            accessible_alternative="implementation_table",
            mobile_sibling="stacked_list" if request.mobile else "implementation_timeline",
        )

    if request.question == "how_entities_are_connected":
        if request.relationship_node_count < 2 or request.relationship_edge_count < 1:
            return _blocked("Relationship graph requires at least two entities and one verified relationship.", "relationship_table")
        if not request.has_verified_lineage:
            return _blocked("Relationship graph is blocked until relationships have verified lineage.", "relationship_table")
        return PlanningViewDecision(
            status="ready",
            kind="relationship_graph",
            reason="The question concerns connected planning entities rather than magnitude comparison.",
            caveats=["Graph proximity and layout position must not imply importance or causation unless encoded explicitly."],
            accessible_alternative="relationship_table",
            mobile_sibling="stacked_list" if request.mobile else "relationship_graph",
        )

    return _blocked("No planning view rule matched the question.", "matrix_table")

from __future__ import annotations

from datetime import date, datetime
from typing import Annotated, Literal, TypedDict
from urllib.parse import urlparse

from langgraph.graph import END, START, StateGraph
from pydantic import Field

from .models import GeographyRef, ReviewStatus, StrictModel

PlanningSourceFamily = Literal[
    "state_clearinghouse",
    "county_local_health_department",
    "regional_planning_collaborative",
    "hospital_chna_csp_page",
]
PlanningScope = Literal["county_specific", "regional", "hospital_specific", "state_level"]
PlanningDocumentType = Literal[
    "cha",
    "chip",
    "chna",
    "csp",
    "implementation_strategy",
    "supporting_report",
]
ResearchLane = Literal["county_public_health", "regional", "hospital"]


class ApprovedPlanningSource(StrictModel):
    id: str = Field(min_length=1)
    source_family: PlanningSourceFamily
    publisher: str = Field(min_length=1)
    approved_hosts: list[str] = Field(min_length=1)
    source_page_url: str = Field(min_length=1)
    geography_ids: list[str] = Field(default_factory=list)
    review_status: ReviewStatus = ReviewStatus.VERIFIED


class PlanningDocumentCandidate(StrictModel):
    id: str = Field(min_length=1)
    source_seed_id: str = Field(min_length=1)
    source_family: PlanningSourceFamily
    publisher: str = Field(min_length=1)
    source_page_url: str = Field(min_length=1)
    artifact_url: str = Field(min_length=1)
    document_type: PlanningDocumentType
    title: str = Field(min_length=1)
    covered_geography_ids: list[str] = Field(min_length=1)
    coverage_scope: PlanningScope
    publication_date: date | None = None
    plan_cycle_start: date | None = None
    plan_cycle_end: date | None = None
    retrieved_at: datetime
    candidate_confidence: Literal["high", "moderate", "low"]
    candidate_confidence_score: float = Field(ge=0, le=1)
    confidence_reasons: list[str] = Field(default_factory=list)


class RejectedPlanningCandidate(StrictModel):
    candidate_id: str = Field(min_length=1)
    errors: list[str] = Field(min_length=1)


class PlanningLaneResult(StrictModel):
    id: str = Field(min_length=1)
    lane: ResearchLane
    accepted_candidate_ids: list[str] = Field(default_factory=list)
    rejected_candidate_ids: list[str] = Field(default_factory=list)


class PlanningResearchRequest(StrictModel):
    run_id: str = Field(min_length=1)
    county: GeographyRef
    approved_sources: list[ApprovedPlanningSource] = Field(default_factory=list)
    candidate_documents: list[PlanningDocumentCandidate] = Field(default_factory=list)


class PlanningResearchResult(StrictModel):
    run_id: str = Field(min_length=1)
    county_id: str = Field(min_length=1)
    accepted_candidates: list[PlanningDocumentCandidate] = Field(default_factory=list)
    rejected_candidates: list[RejectedPlanningCandidate] = Field(default_factory=list)
    lane_results: list[PlanningLaneResult] = Field(default_factory=list)
    ready_for_acquisition: bool = False


def _host(url: str) -> str:
    parsed = urlparse(url)
    if parsed.scheme != "https" or not parsed.hostname:
        return ""
    return parsed.hostname.lower().rstrip(".")


def _host_allowed(host: str, approved_hosts: list[str]) -> bool:
    normalized = {item.lower().rstrip(".") for item in approved_hosts}
    return host in normalized


def validate_candidate(
    candidate: PlanningDocumentCandidate,
    seed: ApprovedPlanningSource | None,
    county: GeographyRef,
) -> list[str]:
    errors: list[str] = []
    if seed is None:
        return ["candidate source seed is not approved"]
    if seed.review_status != ReviewStatus.VERIFIED:
        errors.append("candidate source seed is not verified")
    if candidate.source_family != seed.source_family:
        errors.append("candidate source family does not match approved seed")
    if candidate.publisher != seed.publisher:
        errors.append("candidate publisher does not match approved seed")
    if candidate.source_page_url != seed.source_page_url:
        errors.append("candidate source page does not match approved seed")

    source_host = _host(candidate.source_page_url)
    artifact_host = _host(candidate.artifact_url)
    if not source_host or not _host_allowed(source_host, seed.approved_hosts):
        errors.append("candidate source page host is not approved HTTPS")
    if not artifact_host or not _host_allowed(artifact_host, seed.approved_hosts):
        errors.append("candidate artifact host is not approved HTTPS")

    if candidate.candidate_confidence == "low" or candidate.candidate_confidence_score < 0.7:
        errors.append("candidate confidence is below autonomous acquisition threshold")
    if county.id not in candidate.covered_geography_ids and candidate.coverage_scope == "county_specific":
        errors.append("county-specific candidate does not include requested county")
    if candidate.document_type in {"chip", "csp"} and candidate.coverage_scope == "hospital_specific":
        errors.append("hospital-specific document cannot be classified as a county CHIP/CSP")
    return list(dict.fromkeys(errors))


def lane_for(candidate: PlanningDocumentCandidate) -> ResearchLane:
    if candidate.source_family == "hospital_chna_csp_page" or candidate.coverage_scope == "hospital_specific":
        return "hospital"
    if candidate.source_family == "regional_planning_collaborative" or candidate.coverage_scope == "regional":
        return "regional"
    return "county_public_health"


def research_candidates(request: PlanningResearchRequest) -> PlanningResearchResult:
    seeds = {item.id: item for item in request.approved_sources}
    accepted: list[PlanningDocumentCandidate] = []
    rejected: list[RejectedPlanningCandidate] = []
    lane_accepts: dict[ResearchLane, list[str]] = {
        "county_public_health": [],
        "regional": [],
        "hospital": [],
    }
    lane_rejects: dict[ResearchLane, list[str]] = {
        "county_public_health": [],
        "regional": [],
        "hospital": [],
    }

    for candidate in request.candidate_documents:
        lane = lane_for(candidate)
        errors = validate_candidate(candidate, seeds.get(candidate.source_seed_id), request.county)
        if errors:
            rejected.append(RejectedPlanningCandidate(candidate_id=candidate.id, errors=errors))
            lane_rejects[lane].append(candidate.id)
        else:
            accepted.append(candidate)
            lane_accepts[lane].append(candidate.id)

    lanes = [
        PlanningLaneResult(
            id=f"{request.run_id}:planning-lane:{lane}",
            lane=lane,
            accepted_candidate_ids=lane_accepts[lane],
            rejected_candidate_ids=lane_rejects[lane],
        )
        for lane in ("county_public_health", "regional", "hospital")
    ]
    return PlanningResearchResult(
        run_id=request.run_id,
        county_id=request.county.id,
        accepted_candidates=accepted,
        rejected_candidates=rejected,
        lane_results=lanes,
        ready_for_acquisition=bool(accepted),
    )


def _merge_unique(existing: list[dict] | None, incoming: list[dict] | None) -> list[dict]:
    merged: dict[str, dict] = {}
    for item in [*(existing or []), *(incoming or [])]:
        merged[str(item["id"])] = item
    return list(merged.values())


class PlanningResearchState(TypedDict, total=False):
    request: dict
    lane_results: Annotated[list[dict], _merge_unique]
    accepted_candidates: Annotated[list[dict], _merge_unique]
    rejected_candidates: Annotated[list[dict], _merge_unique]
    result: dict


def _lane_node(lane: ResearchLane):
    def run_lane(state: PlanningResearchState) -> PlanningResearchState:
        request = PlanningResearchRequest.model_validate(state["request"])
        result = research_candidates(request)
        lane_result = next(item for item in result.lane_results if item.lane == lane)
        accepted = [item for item in result.accepted_candidates if lane_for(item) == lane]
        rejected_ids = set(lane_result.rejected_candidate_ids)
        rejected = [item for item in result.rejected_candidates if item.candidate_id in rejected_ids]
        return {
            "lane_results": [lane_result.model_dump(mode="json")],
            "accepted_candidates": [item.model_dump(mode="json") for item in accepted],
            "rejected_candidates": [
                {"id": f"rejected:{item.candidate_id}", **item.model_dump(mode="json")}
                for item in rejected
            ],
        }

    return run_lane


def join_planning_research(state: PlanningResearchState) -> PlanningResearchState:
    request = PlanningResearchRequest.model_validate(state["request"])
    accepted = [PlanningDocumentCandidate.model_validate(item) for item in state.get("accepted_candidates", [])]
    rejected = []
    for item in state.get("rejected_candidates", []):
        payload = dict(item)
        payload.pop("id", None)
        rejected.append(RejectedPlanningCandidate.model_validate(payload))
    lanes = [PlanningLaneResult.model_validate(item) for item in state.get("lane_results", [])]
    result = PlanningResearchResult(
        run_id=request.run_id,
        county_id=request.county.id,
        accepted_candidates=accepted,
        rejected_candidates=rejected,
        lane_results=lanes,
        ready_for_acquisition=bool(accepted),
    )
    return {"result": result.model_dump(mode="json")}


def build_planning_research_graph():
    """Build the zero-token source-policy stage of the CHA/CHIP research subgraph."""

    builder = StateGraph(PlanningResearchState)
    builder.add_node("county_public_health", _lane_node("county_public_health"))
    builder.add_node("regional", _lane_node("regional"))
    builder.add_node("hospital", _lane_node("hospital"))
    builder.add_node("join", join_planning_research)
    builder.add_edge(START, "county_public_health")
    builder.add_edge(START, "regional")
    builder.add_edge(START, "hospital")
    builder.add_edge(["county_public_health", "regional", "hospital"], "join")
    builder.add_edge("join", END)
    return builder.compile()

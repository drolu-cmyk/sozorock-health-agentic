from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import Field

from .models import EvidenceClaim, PlanDocument, SourceDocument, StrictModel
from .planning_evidence import (
    PlanningEvidenceAdmissionRequest,
    PlanningEvidenceAdmissionResult,
    admit_planning_evidence,
)
from .planning_research import (
    PlanningDocumentCandidate,
    PlanningResearchRequest,
    PlanningResearchResult,
    research_candidates,
)


PlanningTrajectoryStage = Literal[
    "candidate_discovery",
    "candidate_policy",
    "document_admission",
    "claim_admission",
]
PlanningTrajectoryOutcome = Literal[
    "accepted",
    "rejected",
    "quarantined",
    "review_required",
]


class PlanningTrajectoryEvent(StrictModel):
    id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    stage: PlanningTrajectoryStage
    entity_id: str = Field(min_length=1)
    outcome: PlanningTrajectoryOutcome
    reason_codes: list[str] = Field(default_factory=list)
    occurred_at: datetime


class PlanningPipelineRequest(StrictModel):
    research: PlanningResearchRequest
    admission_requests: list[PlanningEvidenceAdmissionRequest] = Field(default_factory=list)


class PlanningPipelineResult(StrictModel):
    run_id: str = Field(min_length=1)
    research_result: PlanningResearchResult
    admission_results: list[PlanningEvidenceAdmissionResult] = Field(default_factory=list)
    admitted_source_documents: list[SourceDocument] = Field(default_factory=list)
    admitted_plan_documents: list[PlanDocument] = Field(default_factory=list)
    admitted_claims: list[EvidenceClaim] = Field(default_factory=list)
    trajectory: list[PlanningTrajectoryEvent] = Field(default_factory=list)
    ready_for_county_graph: bool = False


def _event(
    *,
    run_id: str,
    stage: PlanningTrajectoryStage,
    entity_id: str,
    outcome: PlanningTrajectoryOutcome,
    reason_codes: list[str] | None = None,
) -> PlanningTrajectoryEvent:
    reason_codes = reason_codes or []
    stable_reason = ":".join(sorted(reason_codes)) or "none"
    return PlanningTrajectoryEvent(
        id=f"{run_id}:{stage}:{entity_id}:{outcome}:{stable_reason}",
        run_id=run_id,
        stage=stage,
        entity_id=entity_id,
        outcome=outcome,
        reason_codes=sorted(set(reason_codes)),
        occurred_at=datetime.now(timezone.utc),
    )


def _candidate_by_id(
    candidates: list[PlanningDocumentCandidate],
) -> dict[str, PlanningDocumentCandidate]:
    return {item.id: item for item in candidates}


def run_planning_pipeline(request: PlanningPipelineRequest) -> PlanningPipelineResult:
    research_result = research_candidates(request.research)
    accepted_candidate_ids = {item.id for item in research_result.accepted_candidates}
    trajectory: list[PlanningTrajectoryEvent] = []

    for candidate in research_result.accepted_candidates:
        trajectory.append(
            _event(
                run_id=request.research.run_id,
                stage="candidate_policy",
                entity_id=candidate.id,
                outcome="accepted",
            )
        )
    for rejected in research_result.rejected_candidates:
        trajectory.append(
            _event(
                run_id=request.research.run_id,
                stage="candidate_policy",
                entity_id=rejected.candidate_id,
                outcome="rejected",
                reason_codes=rejected.errors,
            )
        )

    admissions_by_candidate = {
        item.candidate.id: item for item in request.admission_requests
    }
    admission_results: list[PlanningEvidenceAdmissionResult] = []
    admitted_sources: dict[str, SourceDocument] = {}
    admitted_plans: dict[str, PlanDocument] = {}
    admitted_claims: dict[str, EvidenceClaim] = {}

    for candidate_id in sorted(accepted_candidate_ids):
        admission_request = admissions_by_candidate.get(candidate_id)
        if admission_request is None:
            trajectory.append(
                _event(
                    run_id=request.research.run_id,
                    stage="document_admission",
                    entity_id=candidate_id,
                    outcome="review_required",
                    reason_codes=["admission_request_missing"],
                )
            )
            continue

        result = admit_planning_evidence(admission_request)
        admission_results.append(result)

        blocking_reasons = [
            item.reason for item in result.review_tasks if item.severity == "blocking"
        ]
        if result.ready_for_county_graph:
            admitted_sources[admission_request.source_document.id] = admission_request.source_document
            admitted_plans[admission_request.plan_document.id] = admission_request.plan_document
            for claim in result.accepted_claims:
                admitted_claims[claim.id] = claim
            trajectory.append(
                _event(
                    run_id=request.research.run_id,
                    stage="document_admission",
                    entity_id=admission_request.plan_document.id,
                    outcome="accepted",
                )
            )
        else:
            trajectory.append(
                _event(
                    run_id=request.research.run_id,
                    stage="document_admission",
                    entity_id=admission_request.plan_document.id,
                    outcome="review_required",
                    reason_codes=blocking_reasons or ["claim_review_required"],
                )
            )

        for claim in result.accepted_claims:
            claim_tasks = [
                item.reason for item in result.review_tasks if item.entity_id == claim.id
            ]
            trajectory.append(
                _event(
                    run_id=request.research.run_id,
                    stage="claim_admission",
                    entity_id=claim.id,
                    outcome="accepted" if not claim_tasks else "review_required",
                    reason_codes=claim_tasks,
                )
            )
        for claim in result.quarantined_claims:
            claim_tasks = [
                item.reason for item in result.review_tasks if item.entity_id == claim.id
            ]
            trajectory.append(
                _event(
                    run_id=request.research.run_id,
                    stage="claim_admission",
                    entity_id=claim.id,
                    outcome="quarantined",
                    reason_codes=claim_tasks,
                )
            )

    # An admission supplied for a candidate that failed source policy is never
    # processed. Record that rejected trajectory explicitly for evaluation.
    all_candidates = _candidate_by_id(request.research.candidate_documents)
    for candidate_id in sorted(set(admissions_by_candidate) - accepted_candidate_ids):
        if candidate_id in all_candidates:
            trajectory.append(
                _event(
                    run_id=request.research.run_id,
                    stage="document_admission",
                    entity_id=candidate_id,
                    outcome="rejected",
                    reason_codes=["candidate_not_approved"],
                )
            )

    ready = bool(admitted_plans) and all(
        result.ready_for_county_graph for result in admission_results
    ) and len(admission_results) == len(accepted_candidate_ids)

    return PlanningPipelineResult(
        run_id=request.research.run_id,
        research_result=research_result,
        admission_results=admission_results,
        admitted_source_documents=list(admitted_sources.values()),
        admitted_plan_documents=list(admitted_plans.values()),
        admitted_claims=list(admitted_claims.values()),
        trajectory=list({item.id: item for item in trajectory}.values()),
        ready_for_county_graph=ready,
    )

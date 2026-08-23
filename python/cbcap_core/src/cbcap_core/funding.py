from __future__ import annotations

from datetime import date
from typing import Literal

from pydantic import Field

from .models import (
    Confidence,
    DocumentTrust,
    FundingFit,
    FundingOpportunity,
    ReviewStatus,
    SourceDocument,
    StrictModel,
    TenantVisibility,
)

FundingCriterionType = Literal[
    "applicant_type",
    "geography",
    "designation",
    "partner",
    "evidence",
    "plan_priority",
    "barrier",
]
FundingCriterionStatus = Literal["matched", "missing", "failed", "not_applicable"]


class FundingCriterion(StrictModel):
    id: str = Field(min_length=1)
    criterion_type: FundingCriterionType
    description: str = Field(min_length=1)
    required: bool = True
    accepted_values: list[str] = Field(default_factory=list)
    required_entity_ids: list[str] = Field(default_factory=list)
    source_claim_ids: list[str] = Field(default_factory=list)


class FundingApplicantProfile(StrictModel):
    tenant_id: str = Field(min_length=1)
    organization_id: str = Field(min_length=1)
    applicant_types: list[str] = Field(min_length=1)
    geography_ids: list[str] = Field(default_factory=list)
    partner_organization_ids: list[str] = Field(default_factory=list)
    designation_evidence_claim_ids: list[str] = Field(default_factory=list)
    workforce_designation_ids: list[str] = Field(default_factory=list)
    supporting_evidence_claim_ids: list[str] = Field(default_factory=list)
    plan_priority_ids: list[str] = Field(default_factory=list)
    barrier_observation_ids: list[str] = Field(default_factory=list)


class FundingCriterionResult(StrictModel):
    criterion_id: str = Field(min_length=1)
    criterion_type: FundingCriterionType
    status: FundingCriterionStatus
    explanation: str = Field(min_length=1)
    matched_entity_ids: list[str] = Field(default_factory=list)
    source_claim_ids: list[str] = Field(default_factory=list)


class FundingTrajectoryEvent(StrictModel):
    id: str = Field(min_length=1)
    opportunity_id: str = Field(min_length=1)
    stage: Literal["source_validation", "deadline", "criterion", "fit_decision"]
    decision: str = Field(min_length=1)
    reason_codes: list[str] = Field(default_factory=list)
    entity_ids: list[str] = Field(default_factory=list)


class FundingEvaluationRequest(StrictModel):
    opportunity: FundingOpportunity
    source_document: SourceDocument
    applicant: FundingApplicantProfile
    county_id: str = Field(min_length=1)
    state_id: str | None = None
    as_of: date
    criteria: list[FundingCriterion] = Field(default_factory=list)


class FundingEvaluationResult(StrictModel):
    opportunity_id: str = Field(min_length=1)
    source_verified: bool
    deadline_status: Literal["open", "closed", "not_yet_open", "unknown"]
    criterion_results: list[FundingCriterionResult] = Field(default_factory=list)
    eligibility_status: Literal["likely_eligible", "possibly_eligible", "ineligible", "unknown"]
    fit_status: Literal["strong", "moderate", "weak", "not_recommended", "unreviewed"]
    confidence: Confidence
    missing_evidence: list[str] = Field(default_factory=list)
    missing_partner_ids: list[str] = Field(default_factory=list)
    fit: FundingFit | None = None
    trajectory: list[FundingTrajectoryEvent] = Field(default_factory=list)
    caveats: list[str] = Field(default_factory=list)


def _intersection(left: list[str], right: list[str]) -> list[str]:
    return sorted(set(left).intersection(right))


def _designation_pool(applicant: FundingApplicantProfile) -> list[str]:
    return sorted(
        set(applicant.designation_evidence_claim_ids).union(applicant.workforce_designation_ids)
    )


def _entity_pool(applicant: FundingApplicantProfile, criterion_type: FundingCriterionType) -> list[str]:
    pools = {
        "designation": _designation_pool(applicant),
        "partner": applicant.partner_organization_ids,
        "evidence": applicant.supporting_evidence_claim_ids,
        "plan_priority": applicant.plan_priority_ids,
        "barrier": applicant.barrier_observation_ids,
    }
    if criterion_type not in pools:
        return []
    return pools[criterion_type]


def _criterion_result(
    criterion: FundingCriterion,
    applicant: FundingApplicantProfile,
    *,
    county_id: str,
    state_id: str | None,
) -> FundingCriterionResult:
    if criterion.criterion_type == "applicant_type":
        accepted = criterion.accepted_values
        matched = _intersection(applicant.applicant_types, accepted)
        if not accepted:
            return FundingCriterionResult(
                criterion_id=criterion.id,
                criterion_type=criterion.criterion_type,
                status="not_applicable",
                explanation="No applicant type restriction was encoded for this criterion.",
                source_claim_ids=criterion.source_claim_ids,
            )
        return FundingCriterionResult(
            criterion_id=criterion.id,
            criterion_type=criterion.criterion_type,
            status="matched" if matched else "failed",
            explanation="Applicant type matches an encoded eligibility class." if matched else "Applicant type does not match an encoded eligibility class.",
            matched_entity_ids=matched,
            source_claim_ids=criterion.source_claim_ids,
        )

    if criterion.criterion_type == "geography":
        accepted = set(criterion.accepted_values)
        applicant_geo = set(applicant.geography_ids)
        applicant_geo.add(county_id)
        if state_id:
            applicant_geo.add(state_id)
        matched = sorted(accepted.intersection(applicant_geo))
        if not accepted:
            return FundingCriterionResult(
                criterion_id=criterion.id,
                criterion_type=criterion.criterion_type,
                status="not_applicable",
                explanation="No geography restriction was encoded for this criterion.",
                source_claim_ids=criterion.source_claim_ids,
            )
        return FundingCriterionResult(
            criterion_id=criterion.id,
            criterion_type=criterion.criterion_type,
            status="matched" if matched else "failed",
            explanation="The applicant geography matches the encoded opportunity geography." if matched else "The applicant geography does not match the encoded opportunity geography.",
            matched_entity_ids=matched,
            source_claim_ids=criterion.source_claim_ids,
        )

    available = _entity_pool(applicant, criterion.criterion_type)
    required_ids = criterion.required_entity_ids
    matched = _intersection(available, required_ids)
    if not required_ids:
        return FundingCriterionResult(
            criterion_id=criterion.id,
            criterion_type=criterion.criterion_type,
            status="not_applicable",
            explanation="No entity-specific requirement was encoded for this criterion.",
            source_claim_ids=criterion.source_claim_ids,
        )
    status: FundingCriterionStatus = "matched" if set(required_ids).issubset(set(available)) else "missing"
    return FundingCriterionResult(
        criterion_id=criterion.id,
        criterion_type=criterion.criterion_type,
        status=status,
        explanation=(
            "All encoded requirement entities are present in the applicant planning record."
            if status == "matched"
            else "One or more encoded requirement entities are missing from the applicant planning record."
        ),
        matched_entity_ids=matched,
        source_claim_ids=criterion.source_claim_ids,
    )


def _base_criteria(request: FundingEvaluationRequest) -> list[FundingCriterion]:
    criteria = list(request.criteria)
    lineage = request.opportunity.requirement_claim_ids
    if request.opportunity.eligible_applicant_types and not any(
        item.criterion_type == "applicant_type" for item in criteria
    ):
        criteria.append(
            FundingCriterion(
                id=f"{request.opportunity.id}:applicant-type",
                criterion_type="applicant_type",
                description="Opportunity eligible applicant type.",
                required=True,
                accepted_values=request.opportunity.eligible_applicant_types,
                source_claim_ids=lineage,
            )
        )
    if request.opportunity.geography_ids and not any(
        item.criterion_type == "geography" for item in criteria
    ):
        criteria.append(
            FundingCriterion(
                id=f"{request.opportunity.id}:geography",
                criterion_type="geography",
                description="Opportunity geographic eligibility.",
                required=True,
                accepted_values=request.opportunity.geography_ids,
                source_claim_ids=lineage,
            )
        )
    return criteria


def _deadline_status(opportunity: FundingOpportunity, as_of: date) -> str:
    if opportunity.open_date is not None and as_of < opportunity.open_date:
        return "not_yet_open"
    if opportunity.close_date is None:
        return "unknown"
    return "closed" if as_of > opportunity.close_date else "open"


def evaluate_funding_fit(request: FundingEvaluationRequest) -> FundingEvaluationResult:
    opportunity = request.opportunity
    source = request.source_document
    if source.id != opportunity.source_document_id:
        raise ValueError("funding opportunity does not reference the supplied source document")

    source_verified = (
        source.review_status == ReviewStatus.VERIFIED
        and source.trust == DocumentTrust.OFFICIAL_VERIFIED
        and source.visibility == TenantVisibility.PUBLIC
        and opportunity.review_status == ReviewStatus.VERIFIED
    )
    trajectory = [
        FundingTrajectoryEvent(
            id=f"{opportunity.id}:trajectory:source",
            opportunity_id=opportunity.id,
            stage="source_validation",
            decision="verified" if source_verified else "blocked",
            reason_codes=[] if source_verified else ["funding_source_not_verified"],
            entity_ids=[source.id, opportunity.id],
        )
    ]
    if not source_verified:
        return FundingEvaluationResult(
            opportunity_id=opportunity.id,
            source_verified=False,
            deadline_status=_deadline_status(opportunity, request.as_of),
            eligibility_status="unknown",
            fit_status="unreviewed",
            confidence=Confidence.LOW,
            trajectory=trajectory,
            caveats=["Funding fit is blocked until the opportunity and its official public source notice are verified."],
        )

    deadline_status = _deadline_status(opportunity, request.as_of)
    trajectory.append(
        FundingTrajectoryEvent(
            id=f"{opportunity.id}:trajectory:deadline",
            opportunity_id=opportunity.id,
            stage="deadline",
            decision=deadline_status,
            reason_codes=["opportunity_closed"] if deadline_status == "closed" else [],
            entity_ids=[opportunity.id],
        )
    )
    if deadline_status == "closed":
        return FundingEvaluationResult(
            opportunity_id=opportunity.id,
            source_verified=True,
            deadline_status="closed",
            eligibility_status="ineligible",
            fit_status="not_recommended",
            confidence=Confidence.HIGH,
            trajectory=trajectory,
            caveats=["This result describes current eligibility state, not future or renewed program availability."],
        )

    criteria = _base_criteria(request)
    untraceable_required = [item for item in criteria if item.required and not item.source_claim_ids]
    if untraceable_required:
        for item in untraceable_required:
            trajectory.append(
                FundingTrajectoryEvent(
                    id=f"{opportunity.id}:trajectory:criterion:{item.id}:lineage",
                    opportunity_id=opportunity.id,
                    stage="criterion",
                    decision="blocked",
                    reason_codes=["required_criterion_missing_source_lineage"],
                    entity_ids=[item.id],
                )
            )
        return FundingEvaluationResult(
            opportunity_id=opportunity.id,
            source_verified=True,
            deadline_status=deadline_status,
            eligibility_status="unknown",
            fit_status="unreviewed",
            confidence=Confidence.LOW,
            trajectory=trajectory,
            caveats=["One or more required funding criteria lack verified source-claim lineage and cannot be used for eligibility reasoning."],
        )

    results = [
        _criterion_result(
            item,
            request.applicant,
            county_id=request.county_id,
            state_id=request.state_id,
        )
        for item in criteria
    ]
    for item in results:
        trajectory.append(
            FundingTrajectoryEvent(
                id=f"{opportunity.id}:trajectory:criterion:{item.criterion_id}",
                opportunity_id=opportunity.id,
                stage="criterion",
                decision=item.status,
                reason_codes=[f"{item.criterion_type}_{item.status}"],
                entity_ids=item.matched_entity_ids,
            )
        )

    by_id = {item.id: item for item in criteria}
    required_applicable = [
        result
        for result in results
        if by_id[result.criterion_id].required and result.status != "not_applicable"
    ]
    hard_failed = [result for result in required_applicable if result.status == "failed"]
    hard_missing = [result for result in required_applicable if result.status == "missing"]

    if hard_failed:
        eligibility = "ineligible"
    elif hard_missing:
        eligibility = "possibly_eligible"
    elif required_applicable:
        eligibility = "likely_eligible"
    else:
        eligibility = "unknown"

    matched_types = {item.criterion_type for item in results if item.status == "matched"}
    planning_alignment_count = len(
        matched_types.intersection({"plan_priority", "barrier", "designation", "evidence"})
    )
    if eligibility == "ineligible":
        fit_status = "not_recommended"
        confidence = Confidence.HIGH
    elif eligibility == "likely_eligible" and planning_alignment_count >= 2:
        fit_status = "strong"
        confidence = Confidence.HIGH
    elif eligibility == "likely_eligible" and planning_alignment_count >= 1:
        fit_status = "moderate"
        confidence = Confidence.MODERATE
    elif eligibility == "possibly_eligible":
        fit_status = "weak"
        confidence = Confidence.MODERATE
    else:
        fit_status = "unreviewed"
        confidence = Confidence.LOW

    missing_evidence: list[str] = []
    missing_partner_ids: list[str] = []
    for result in hard_missing:
        criterion = by_id[result.criterion_id]
        if result.criterion_type in {"designation", "evidence", "plan_priority", "barrier"}:
            available = set(_entity_pool(request.applicant, result.criterion_type))
            missing_evidence.extend(sorted(set(criterion.required_entity_ids) - available))
        if result.criterion_type == "partner":
            missing_partner_ids.extend(
                sorted(set(criterion.required_entity_ids) - set(request.applicant.partner_organization_ids))
            )

    fit = FundingFit(
        id=f"funding-fit:{request.applicant.tenant_id}:{opportunity.id}",
        opportunity_id=opportunity.id,
        tenant_id=request.applicant.tenant_id,
        geography_id=request.county_id,
        plan_priority_ids=request.applicant.plan_priority_ids,
        barrier_observation_ids=request.applicant.barrier_observation_ids,
        designation_evidence_claim_ids=[
            *request.applicant.designation_evidence_claim_ids,
            *request.applicant.workforce_designation_ids,
        ],
        supporting_evidence_claim_ids=request.applicant.supporting_evidence_claim_ids,
        missing_evidence=sorted(set(missing_evidence)),
        eligibility_status=eligibility,
        fit_status=fit_status,
        confidence=confidence,
        review_status=ReviewStatus.PROVISIONAL,
    )
    trajectory.append(
        FundingTrajectoryEvent(
            id=f"{opportunity.id}:trajectory:fit",
            opportunity_id=opportunity.id,
            stage="fit_decision",
            decision=fit_status,
            reason_codes=[f"eligibility_{eligibility}", f"fit_{fit_status}"],
            entity_ids=[fit.id],
        )
    )

    caveats = [
        "Funding fit is a planning assessment, not an award prediction or guarantee.",
        "A provisional fit requires review before it becomes organizational decision memory.",
    ]
    if deadline_status == "not_yet_open":
        caveats.append("The opportunity is not yet open; current application action is not available.")
    if deadline_status == "unknown":
        caveats.append("The application deadline is not verified and must be confirmed before action.")
    if eligibility == "unknown":
        caveats.append("The available required criteria are insufficient to assert likely eligibility.")

    return FundingEvaluationResult(
        opportunity_id=opportunity.id,
        source_verified=True,
        deadline_status=deadline_status,
        criterion_results=results,
        eligibility_status=eligibility,
        fit_status=fit_status,
        confidence=confidence,
        missing_evidence=sorted(set(missing_evidence)),
        missing_partner_ids=sorted(set(missing_partner_ids)),
        fit=fit,
        trajectory=trajectory,
        caveats=caveats,
    )

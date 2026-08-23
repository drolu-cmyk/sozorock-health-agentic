from __future__ import annotations

from datetime import datetime
from typing import Literal

from pydantic import Field

from .decision_memory import DecisionMemoryProposal
from .models import FundingFit, ReviewStatus, StrictModel

FundingPursuitAction = Literal["pursue", "defer", "decline"]
FundingDecisionActorRole = Literal["planner", "reviewer", "admin"]


class FundingPursuitDecisionRequest(StrictModel):
    funding_fit: FundingFit
    actor_tenant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    actor_role: FundingDecisionActorRole
    action: FundingPursuitAction
    reason_codes: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)
    decided_at: datetime
    required_partner_ids: list[str] = Field(default_factory=list)
    unresolved_requirement_ids: list[str] = Field(default_factory=list)


class FundingPursuitDecisionResult(StrictModel):
    action: FundingPursuitAction
    opportunity_id: str = Field(min_length=1)
    funding_fit_id: str = Field(min_length=1)
    memory_proposal: DecisionMemoryProposal


def build_funding_pursuit_decision(
    request: FundingPursuitDecisionRequest,
) -> FundingPursuitDecisionResult:
    fit = request.funding_fit
    if fit.tenant_id != request.actor_tenant_id:
        raise ValueError("funding decision tenant does not match authenticated actor tenant")
    if fit.review_status != ReviewStatus.VERIFIED:
        raise ValueError("organizational funding decision requires a reviewed funding-fit assessment")
    if request.action == "pursue" and fit.eligibility_status == "ineligible":
        raise ValueError("cannot pursue an opportunity whose reviewed funding fit is ineligible")
    if request.action == "pursue" and request.unresolved_requirement_ids:
        raise ValueError("pursue decision cannot hide unresolved funding requirements")

    outcome_map = {
        "pursue": "accepted",
        "defer": "deferred",
        "decline": "rejected",
    }
    evidence_ids = list(dict.fromkeys([
        fit.id,
        *fit.supporting_evidence_claim_ids,
        *fit.designation_evidence_claim_ids,
        *fit.plan_priority_ids,
        *fit.barrier_observation_ids,
    ]))
    memory = DecisionMemoryProposal(
        tenant_id=fit.tenant_id,
        geography_id=fit.geography_id,
        decision_type="funding_fit",
        subject_type="funding_pursuit_decision",
        subject_id=fit.opportunity_id,
        outcome=outcome_map[request.action],
        reason_codes=list(dict.fromkeys([
            f"action:{request.action}",
            f"eligibility:{fit.eligibility_status}",
            f"fit:{fit.fit_status}",
            *request.reason_codes,
        ])),
        rationale=request.rationale,
        evidence_entity_ids=evidence_ids,
        related_entity_ids=list(dict.fromkeys([
            fit.id,
            *request.required_partner_ids,
        ])),
        missing_requirements=list(dict.fromkeys([
            *fit.missing_evidence,
            *request.unresolved_requirement_ids,
        ])),
        applicability="context_specific",
    )
    return FundingPursuitDecisionResult(
        action=request.action,
        opportunity_id=fit.opportunity_id,
        funding_fit_id=fit.id,
        memory_proposal=memory,
    )

from datetime import date, datetime, timezone

from cbcap_core.funding import (
    FundingApplicantProfile,
    FundingCriterion,
    FundingEvaluationRequest,
    evaluate_funding_fit,
)
from cbcap_core.models import (
    DocumentTrust,
    FundingOpportunity,
    ReviewStatus,
    SourceDocument,
    SourceVersionRef,
    TenantVisibility,
)

NOW = datetime(2026, 8, 22, 22, 30, tzinfo=timezone.utc)


def source(*, status=ReviewStatus.VERIFIED, trust=DocumentTrust.OFFICIAL_VERIFIED):
    version = SourceVersionRef(
        source_id="grants-gov",
        source_version_id="grants-gov:opp-1:2026-08-22",
        publisher="Official funding publisher",
        title="Controlled funding notice",
        official_url="https://example.gov/funding/opp-1",
        release_label="2026",
        release_date=date(2026, 8, 1),
        retrieved_at=NOW,
        content_hash="sha256:" + "f" * 64,
        schema_version="funding.v1",
        review_status=status,
    )
    return SourceDocument(
        id="funding-document:opp-1",
        source_version=version,
        document_type="funding_notice",
        geography_ids=["county:36001"],
        content_hash="sha256:" + "e" * 64,
        content_locator="https://example.gov/funding/opp-1",
        trust=trust,
        visibility=TenantVisibility.PUBLIC,
        review_status=status,
    )


def opportunity(*, open_date=date(2026, 8, 1), close_date=date(2026, 10, 1), status=ReviewStatus.VERIFIED):
    return FundingOpportunity(
        id="funding:opp-1",
        source_document_id="funding-document:opp-1",
        title="Community planning opportunity",
        program_name="Controlled program",
        open_date=open_date,
        close_date=close_date,
        eligible_applicant_types=["local_health_department"],
        geography_ids=["county:36001"],
        requirement_claim_ids=["claim:eligibility"],
        review_status=status,
    )


def applicant(*, applicant_types=None, partners=None):
    return FundingApplicantProfile(
        tenant_id="tenant-a",
        organization_id="org:health-department",
        applicant_types=applicant_types or ["local_health_department"],
        geography_ids=["county:36001"],
        partner_organization_ids=partners or [],
        designation_evidence_claim_ids=["claim:hpsa"],
        supporting_evidence_claim_ids=["claim:need"],
        plan_priority_ids=["priority:access"],
        barrier_observation_ids=["barrier:transportation"],
    )


def aligned_criteria(*, require_partner=False):
    items = [
        FundingCriterion(
            id="criterion:priority",
            criterion_type="plan_priority",
            description="Documented local plan priority alignment.",
            required=True,
            required_entity_ids=["priority:access"],
            source_claim_ids=["claim:funding-priority"],
        ),
        FundingCriterion(
            id="criterion:barrier",
            criterion_type="barrier",
            description="Documented community barrier alignment.",
            required=True,
            required_entity_ids=["barrier:transportation"],
            source_claim_ids=["claim:funding-barrier"],
        ),
    ]
    if require_partner:
        items.append(
            FundingCriterion(
                id="criterion:partner",
                criterion_type="partner",
                description="Required implementation partner.",
                required=True,
                required_entity_ids=["org:required-partner"],
                source_claim_ids=["claim:partner-required"],
            )
        )
    return items


def evaluate(*, opp=None, doc=None, profile=None, criteria=None, as_of=date(2026, 8, 22)):
    return evaluate_funding_fit(
        FundingEvaluationRequest(
            opportunity=opp or opportunity(),
            source_document=doc or source(),
            applicant=profile or applicant(),
            county_id="county:36001",
            state_id="state:36",
            as_of=as_of,
            criteria=criteria if criteria is not None else aligned_criteria(),
        )
    )


def test_verified_alignment_produces_strong_planning_fit_without_award_claim():
    result = evaluate()
    assert result.source_verified is True
    assert result.deadline_status == "open"
    assert result.eligibility_status == "likely_eligible"
    assert result.fit_status == "strong"
    assert result.fit is not None
    assert result.fit.review_status == ReviewStatus.PROVISIONAL
    assert any("not an award prediction or guarantee" in item.lower() for item in result.caveats)


def test_ineligible_applicant_type_fails_hard_criterion():
    result = evaluate(profile=applicant(applicant_types=["for_profit_company"]))
    assert result.eligibility_status == "ineligible"
    assert result.fit_status == "not_recommended"
    assert any(
        item.criterion_type == "applicant_type" and item.status == "failed"
        for item in result.criterion_results
    )


def test_missing_required_partner_is_visible_as_remediable_gap():
    result = evaluate(criteria=aligned_criteria(require_partner=True))
    assert result.eligibility_status == "possibly_eligible"
    assert result.fit_status == "weak"
    assert result.missing_partner_ids == ["org:required-partner"]


def test_unverified_or_untrusted_source_blocks_fit_before_criteria():
    result = evaluate(doc=source(trust=DocumentTrust.UNTRUSTED_EXTERNAL))
    assert result.source_verified is False
    assert result.eligibility_status == "unknown"
    assert result.fit_status == "unreviewed"
    assert result.fit is None


def test_closed_opportunity_is_not_recommended_even_if_alignment_would_be_strong():
    result = evaluate(
        opp=opportunity(close_date=date(2026, 8, 1)),
        as_of=date(2026, 8, 22),
    )
    assert result.deadline_status == "closed"
    assert result.eligibility_status == "ineligible"
    assert result.fit_status == "not_recommended"


def test_upcoming_opportunity_is_distinct_from_open_opportunity():
    result = evaluate(
        opp=opportunity(open_date=date(2026, 9, 1), close_date=date(2026, 11, 1)),
        as_of=date(2026, 8, 22),
    )
    assert result.deadline_status == "not_yet_open"
    assert any("not yet open" in item.lower() for item in result.caveats)


def test_funding_trajectory_retains_criterion_decisions_for_future_evaluation():
    result = evaluate()
    stages = {item.stage for item in result.trajectory}
    assert {"source_validation", "deadline", "criterion", "fit_decision"}.issubset(stages)

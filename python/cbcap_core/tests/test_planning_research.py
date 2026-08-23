from datetime import datetime, timezone

from cbcap_core.models import GeographyKind, GeographyRef, ReviewStatus
from cbcap_core.planning_research import (
    ApprovedPlanningSource,
    PlanningDocumentCandidate,
    PlanningResearchRequest,
    PlanningResearchResult,
    build_planning_research_graph,
    research_candidates,
)

NOW = datetime(2026, 8, 22, 22, 0, tzinfo=timezone.utc)


def county() -> GeographyRef:
    return GeographyRef(
        id="county:42029",
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id="42029",
        name="Chester County",
        display_name="Chester County, Pennsylvania",
        state_fips="42",
        county_fips="42029",
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )


def seed(seed_id: str, family: str, host: str, page: str) -> ApprovedPlanningSource:
    return ApprovedPlanningSource(
        id=seed_id,
        source_family=family,
        publisher="Approved Publisher",
        approved_hosts=[host],
        source_page_url=page,
        geography_ids=[county().id],
    )


def candidate(
    candidate_id: str,
    seed_id: str,
    family: str,
    page: str,
    artifact: str,
    scope: str,
    document_type: str,
) -> PlanningDocumentCandidate:
    return PlanningDocumentCandidate(
        id=candidate_id,
        source_seed_id=seed_id,
        source_family=family,
        publisher="Approved Publisher",
        source_page_url=page,
        artifact_url=artifact,
        document_type=document_type,
        title="Controlled planning document",
        covered_geography_ids=[county().id],
        coverage_scope=scope,
        retrieved_at=NOW,
        candidate_confidence="high",
        candidate_confidence_score=0.95,
        confidence_reasons=["official publisher page"],
    )


def request() -> PlanningResearchRequest:
    county_page = "https://health.example.gov/community-health"
    regional_page = "https://regional.example.org/reports"
    hospital_page = "https://hospital.example.org/chna"
    sources = [
        seed("county-seed", "county_local_health_department", "health.example.gov", county_page),
        seed("regional-seed", "regional_planning_collaborative", "regional.example.org", regional_page),
        seed("hospital-seed", "hospital_chna_csp_page", "hospital.example.org", hospital_page),
    ]
    candidates = [
        candidate(
            "county-cha",
            "county-seed",
            "county_local_health_department",
            county_page,
            "https://health.example.gov/files/cha.pdf",
            "county_specific",
            "cha",
        ),
        candidate(
            "regional-chna",
            "regional-seed",
            "regional_planning_collaborative",
            regional_page,
            "https://regional.example.org/files/chna.pdf",
            "regional",
            "chna",
        ),
        candidate(
            "hospital-chna",
            "hospital-seed",
            "hospital_chna_csp_page",
            hospital_page,
            "https://hospital.example.org/files/chna.pdf",
            "hospital_specific",
            "chna",
        ),
    ]
    return PlanningResearchRequest(
        run_id="planning-run",
        county=county(),
        approved_sources=sources,
        candidate_documents=candidates,
    )


def test_controlled_research_accepts_approved_sources_across_three_lanes():
    result = research_candidates(request())
    assert result.ready_for_acquisition is True
    assert {item.id for item in result.accepted_candidates} == {
        "county-cha",
        "regional-chna",
        "hospital-chna",
    }
    assert {item.lane for item in result.lane_results} == {
        "county_public_health",
        "regional",
        "hospital",
    }


def test_unapproved_artifact_host_is_rejected():
    req = request()
    bad = req.candidate_documents[0].model_copy(
        update={"id": "bad-host", "artifact_url": "https://attacker.example/files/cha.pdf"}
    )
    req = req.model_copy(update={"candidate_documents": [bad]})
    result = research_candidates(req)
    assert result.ready_for_acquisition is False
    assert result.rejected_candidates[0].candidate_id == "bad-host"
    assert "candidate artifact host is not approved HTTPS" in result.rejected_candidates[0].errors


def test_hospital_specific_chip_cannot_be_promoted_as_county_plan():
    req = request()
    hospital = req.candidate_documents[2].model_copy(
        update={"id": "bad-chip", "document_type": "chip"}
    )
    req = req.model_copy(update={"candidate_documents": [hospital]})
    result = research_candidates(req)
    assert result.ready_for_acquisition is False
    assert "hospital-specific document cannot be classified as a county CHIP/CSP" in result.rejected_candidates[0].errors


def test_planning_research_graph_fans_out_then_joins():
    graph = build_planning_research_graph()
    output = graph.invoke({"request": request().model_dump(mode="json")})
    result = PlanningResearchResult.model_validate(output["result"])
    assert result.ready_for_acquisition is True
    assert len(result.lane_results) == 3
    assert len(result.accepted_candidates) == 3

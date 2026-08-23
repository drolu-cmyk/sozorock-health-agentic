from datetime import date, datetime, timezone

from cbcap_core import (
    BarrierFamily,
    CountyGraphContext,
    CountyRunState,
    GeographyKind,
    GeographyRef,
    Measure,
    MetricSemantics,
    PlanDocument,
    ReviewStatus,
    RunStatus,
    SourceVersionRef,
    build_county_planning_graph,
    initial_graph_state,
)
from cbcap_core.gateway import PublicEvidencePackage, SourceCoverageAssertion

NOW = datetime(2026, 8, 22, 22, 0, tzinfo=timezone.utc)


def county() -> GeographyRef:
    return GeographyRef(
        id="county:36001",
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id="36001",
        name="Albany County",
        display_name="Albany County, New York",
        state_fips="36",
        county_fips="36001",
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )


def source(source_id: str, title: str) -> SourceVersionRef:
    return SourceVersionRef(
        source_id=source_id,
        source_version_id=f"{source_id}:2026",
        publisher="Official publisher",
        title=title,
        official_url="https://example.gov/source",
        release_label="2026",
        release_date=date(2026, 1, 1),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="evidence.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def transportation_measure() -> Measure:
    semantics = MetricSemantics(
        id="transportation",
        source_measure_id="LACKTRPT",
        name="Lack of reliable transportation",
        description="Adults reporting lack of reliable transportation.",
        direction="adverse",
        higher_value_meaning="adverse",
        unit="percent",
        universe="adults",
        adjustment="modeled",
        comparison_policy="higher_is_concern",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        allowed_visualizations=["choropleth", "ranked_dot"],
        review_status=ReviewStatus.VERIFIED,
    )
    return Measure(
        id="measure:transportation:36001:2026",
        semantics=semantics,
        geography=county(),
        source_version=source("cdc-places", "PLACES"),
        geography_level="county",
        value=9.4,
        numeric_value=9.4,
        source_metadata={},
        review_status=ReviewStatus.VERIFIED,
    )


def hpsa_measure() -> Measure:
    semantics = MetricSemantics(
        id="hpsa-designation",
        source_measure_id="HPSA_DESIGNATION",
        name="Current HRSA shortage-area designation",
        description="Official HPSA designation with retained source scope.",
        direction="contextual",
        higher_value_meaning="context_dependent",
        unit="designation",
        universe="HRSA shortage-area designations",
        adjustment="not_applicable",
        comparison_policy="context_only",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    return Measure(
        id="measure:hpsa:primary-care:36001",
        semantics=semantics,
        geography=county(),
        source_version=source("hrsa-workforce", "HPSA"),
        geography_level="county",
        value="Designated",
        numeric_value=17.0,
        data_period_start=date(2024, 1, 1),
        source_metadata={
            "designationName": "Albany County Primary Care HPSA",
            "designationType": "Geographic HPSA",
            "componentType": "Single County",
            "discipline": "Primary Care",
            "designationStatus": "Designated",
            "lastUpdateDate": "2026-08-20",
            "wholeCountyGeographicDesignation": True,
            "sourceGeographyIdentificationNumber": "36001",
        },
        review_status=ReviewStatus.VERIFIED,
    )


def hpsa_coverage() -> list[SourceCoverageAssertion]:
    hrsa = source("hrsa-workforce", "HPSA")
    return [
        SourceCoverageAssertion(
            id="coverage:hpsa:primary:36001",
            source_id="hrsa-workforce",
            source_version_id=hrsa.source_version_id,
            geography_id=county().id,
            coverage_key="hpsa:primary_care",
            status="complete_with_records",
            records_matched=1,
            evaluated_at=NOW,
            review_status=ReviewStatus.VERIFIED,
        ),
        SourceCoverageAssertion(
            id="coverage:hpsa:dental:36001",
            source_id="hrsa-workforce",
            source_version_id=hrsa.source_version_id,
            geography_id=county().id,
            coverage_key="hpsa:dental",
            status="complete_no_records",
            records_matched=0,
            evaluated_at=NOW,
            review_status=ReviewStatus.VERIFIED,
        ),
        SourceCoverageAssertion(
            id="coverage:hpsa:mental:36001",
            source_id="hrsa-workforce",
            source_version_id=hrsa.source_version_id,
            geography_id=county().id,
            coverage_key="hpsa:mental_health",
            status="complete_no_records",
            records_matched=0,
            evaluated_at=NOW,
            review_status=ReviewStatus.VERIFIED,
        ),
    ]


def public_package() -> dict:
    transportation = transportation_measure()
    hpsa = hpsa_measure()
    package = PublicEvidencePackage(
        release_id="barrier-integration-release",
        generated_at=NOW,
        geographies=[county()],
        metric_semantics=[transportation.semantics, hpsa.semantics],
        measures=[transportation, hpsa],
        source_versions=[transportation.source_version, hpsa.source_version],
        source_coverage=hpsa_coverage(),
    )
    return package.model_dump(mode="json")


def run_with_non_barrier_requirements() -> CountyRunState:
    plan = PlanDocument(
        id="plan:albany-chip",
        source_document_id="document:albany-chip",
        document_type="chip",
        title="Controlled current CHIP",
        publisher="Albany County Department of Health",
        geography_ids=[county().id],
        published_at=date(2026, 1, 1),
        period_start=date(2026, 1, 1),
        period_end=date(2029, 12, 31),
        current_plan_status="verified_current",
        review_status=ReviewStatus.VERIFIED,
    )
    return CountyRunState(
        run_id="barrier-auto-run",
        county=county(),
        requested_at=NOW,
        plan_documents=[plan],
    )


def test_public_gateway_measure_creates_barrier_observation_without_model_call():
    graph = build_county_planning_graph()
    run = run_with_non_barrier_requirements()
    result = graph.invoke(
        initial_graph_state(run),
        config={"configurable": {"thread_id": run.run_id}},
        context=CountyGraphContext(public_evidence_package=public_package()),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.COMPLETED
    assert final.flags.safe_to_publish is True
    assert {item.barrier_family for item in final.barrier_observations} == {
        BarrierFamily.TRANSPORTATION_TRAVEL,
        BarrierFamily.WORKFORCE,
    }
    transportation = next(
        item for item in final.barrier_observations
        if item.barrier_family == BarrierFamily.TRANSPORTATION_TRAVEL
    )
    assert transportation.observed_value == 9.4
    assert any(
        item["stage"] == "barrier_classification" and item["outcome"] == "admitted"
        for item in result["trajectory_events"]
    )


def test_unmapped_public_measure_blocks_barrier_branch_instead_of_guessing():
    payload = public_package()
    payload["metric_semantics"][0]["id"] = "unknown_metric"
    payload["metric_semantics"][0]["source_measure_id"] = "UNKNOWN_METRIC"
    payload["measures"][0]["semantics"] = payload["metric_semantics"][0]

    graph = build_county_planning_graph()
    run = run_with_non_barrier_requirements()
    result = graph.invoke(
        initial_graph_state(run),
        config={"configurable": {"thread_id": "barrier-unmapped"}},
        context=CountyGraphContext(public_evidence_package=payload),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.BLOCKED
    assert final.flags.safe_to_publish is False
    assert {item.barrier_family for item in final.barrier_observations} == {
        BarrierFamily.WORKFORCE
    }
    assert any(
        item["stage"] == "barrier_classification"
        and item["outcome"] == "rejected"
        and "measure_not_in_barrier_ontology" in item["reason_codes"]
        for item in result["trajectory_events"]
    )

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
        value=9.4,
        numeric_value=9.4,
        review_status=ReviewStatus.VERIFIED,
    )


def public_package() -> dict:
    measure = transportation_measure()
    return {
        "contract_version": "sozorock.evidence-gateway.v1",
        "release_id": "barrier-integration-release",
        "generated_at": NOW.isoformat(),
        "geographies": [county().model_dump(mode="json")],
        "geography_relationships": [],
        "metric_semantics": [measure.semantics.model_dump(mode="json")],
        "measures": [measure.model_dump(mode="json")],
        "source_versions": [measure.source_version.model_dump(mode="json")],
    }


def run_with_non_barrier_requirements() -> CountyRunState:
    workforce_semantics = MetricSemantics(
        id="primary_care_shortage",
        source_measure_id="HPSA_PRIMARY_CARE",
        name="Primary care shortage context",
        description="Controlled workforce evidence.",
        direction="contextual",
        higher_value_meaning="context_dependent",
        unit="designation",
        universe="county",
        adjustment="not_applicable",
        comparison_policy="context_only",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    workforce = Measure(
        id="measure:primary-care-shortage:36001",
        semantics=workforce_semantics,
        geography=county(),
        source_version=source("hrsa-workforce", "HPSA"),
        value=True,
        numeric_value=None,
        review_status=ReviewStatus.VERIFIED,
    )
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
        measures=[workforce],
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
    assert len(final.barrier_observations) == 1
    assert final.barrier_observations[0].barrier_family == BarrierFamily.TRANSPORTATION_TRAVEL
    assert final.barrier_observations[0].observed_value == 9.4
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
    assert final.barrier_observations == []
    assert any(
        item["stage"] == "barrier_classification"
        and item["outcome"] == "rejected"
        and "measure_not_in_barrier_ontology" in item["reason_codes"]
        for item in result["trajectory_events"]
    )

from datetime import date, datetime, timezone

from cbcap_core import (
    BarrierFamily,
    CountyGraphContext,
    CountyRunState,
    DocumentTrust,
    GeographyKind,
    GeographyRef,
    MetricSemantics,
    PlanDocument,
    PublicEvidenceMeasure,
    PublicEvidencePackage,
    ReviewStatus,
    RunStatus,
    SourceDocument,
    SourceVersionRef,
    TenantVisibility,
    build_county_planning_graph,
    initial_graph_state,
)

NOW = datetime(2026, 8, 22, 22, 30, tzinfo=timezone.utc)


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


def source_version(source_id: str, title: str) -> SourceVersionRef:
    return SourceVersionRef(
        source_id=source_id,
        source_version_id=f"{source_id}:2026-08-22",
        publisher="Official publisher",
        title=title,
        official_url="https://example.gov/source",
        release_label="2026-08-22",
        release_date=date(2026, 8, 22),
        retrieved_at=NOW,
        content_hash="sha256:" + source_id.replace("-", "a")[:8].ljust(64, "a"),
        schema_version="test.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def transportation_measure() -> PublicEvidenceMeasure:
    semantics = MetricSemantics(
        id="transportation",
        source_measure_id="LACKTRPT",
        name="Lack of reliable transportation",
        description="Adults reporting a lack of reliable transportation.",
        direction="adverse",
        higher_value_meaning="adverse",
        unit="percent",
        universe="adults",
        adjustment="modeled",
        comparison_policy="higher_is_concern",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    return PublicEvidenceMeasure(
        id="measure:transportation:36001:2026",
        semantics=semantics,
        geography=county(),
        source_version=source_version("cdc-places", "CDC PLACES"),
        geography_level="county",
        value=9.5,
        numeric_value=9.5,
        review_status=ReviewStatus.VERIFIED,
    )


def hpsa_measure(
    *,
    scope: str = "county",
    whole_county: bool = True,
    discipline: str = "Primary Care",
    component_type: str = "Single County",
    designation_type: str = "Geographic HPSA",
    observation_id: str = "observation:hpsa:county",
) -> PublicEvidenceMeasure:
    semantics = MetricSemantics(
        id="hpsa-designation",
        source_measure_id="HPSA_DESIGNATION",
        name="Current HRSA shortage-area designation",
        description="Official HPSA designation with retained source scope.",
        direction="contextual",
        higher_value_meaning="context_dependent",
        unit="designation",
        universe="HRSA Health Professional Shortage Area designations",
        adjustment="not_applicable",
        comparison_policy="context_only",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    return PublicEvidenceMeasure(
        id=observation_id,
        semantics=semantics,
        geography=county(),
        source_version=source_version("hrsa-workforce", "Health Professional Shortage Areas"),
        geography_level=scope,
        value="Designated",
        numeric_value=17.0,
        data_period_start=date(2024, 1, 1),
        source_metadata={
            "designationName": "Albany County HPSA",
            "designationType": designation_type,
            "componentType": component_type,
            "discipline": discipline,
            "designationStatus": "Designated",
            "lastUpdateDate": "2026-08-20",
            "wholeCountyGeographicDesignation": whole_county,
            "sourceGeographyIdentificationNumber": "36001",
        },
        review_status=ReviewStatus.VERIFIED,
    )


def planning_state() -> tuple[SourceDocument, PlanDocument]:
    source = SourceDocument(
        id="document:albany-chip",
        source_version=source_version("local-planning-documents", "Albany County CHIP"),
        document_type="chip",
        geography_ids=[county().id],
        content_hash="sha256:" + "b" * 64,
        content_locator="s3://cbcap-evidence/albany/chip.pdf",
        trust=DocumentTrust.OFFICIAL_VERIFIED,
        visibility=TenantVisibility.PUBLIC,
        review_status=ReviewStatus.VERIFIED,
    )
    plan = PlanDocument(
        id="plan:albany-chip",
        source_document_id=source.id,
        document_type="chip",
        title="Albany County Community Health Improvement Plan",
        publisher="Albany County",
        geography_ids=[county().id],
        published_at=date(2026, 1, 1),
        current_plan_status="verified_current",
        review_status=ReviewStatus.VERIFIED,
    )
    return source, plan


def run_state(run_id: str) -> CountyRunState:
    source, plan = planning_state()
    return CountyRunState(
        run_id=run_id,
        county=county(),
        requested_at=NOW,
        source_documents=[source],
        plan_documents=[plan],
    )


def package(*measures: PublicEvidenceMeasure) -> PublicEvidencePackage:
    semantics = {item.semantics.id: item.semantics for item in measures}
    sources = {item.source_version.source_version_id: item.source_version for item in measures}
    return PublicEvidencePackage(
        release_id="release:workforce-test",
        generated_at=NOW,
        geographies=[county()],
        metric_semantics=list(semantics.values()),
        measures=list(measures),
        source_versions=list(sources.values()),
    )


def config(run_id: str) -> dict:
    return {"configurable": {"thread_id": run_id}}


def workforce_payload(result: dict) -> dict:
    return next(
        item for item in result["branch_payloads"] if item["branch"] == "workforce_designations"
    )


def test_whole_county_hpsa_survives_join_and_creates_workforce_barrier():
    graph = build_county_planning_graph()
    run = run_state("workforce-county")
    result = graph.invoke(
        initial_graph_state(run),
        config=config(run.run_id),
        context=CountyGraphContext(
            public_evidence_package=package(
                transportation_measure(),
                hpsa_measure(),
            ).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])

    assert final.status == RunStatus.COMPLETED
    assert any(item.source_version.source_id == "hrsa-workforce" for item in final.measures)
    assert {item.barrier_family for item in final.barrier_observations} == {
        BarrierFamily.TRANSPORTATION_TRAVEL,
        BarrierFamily.WORKFORCE,
    }

    payload = workforce_payload(result)
    assert len(payload["workforce_designations"]) == 1
    assert payload["workforce_designations"][0]["scope"] == "county"
    assert any(
        item["stage"] == "workforce_scope" and item["outcome"] == "county_shortage"
        for item in result["trajectory_events"]
    )


def test_facility_hpsa_remains_context_and_does_not_create_county_barrier():
    graph = build_county_planning_graph()
    run = run_state("workforce-facility")
    facility = hpsa_measure(
        scope="facility",
        whole_county=False,
        discipline="Mental Health",
        component_type="Federally Qualified Health Center",
        designation_type="Facility HPSA",
        observation_id="observation:hpsa:facility",
    )
    result = graph.invoke(
        initial_graph_state(run),
        config=config(run.run_id),
        context=CountyGraphContext(
            public_evidence_package=package(transportation_measure(), facility).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])

    assert final.status == RunStatus.COMPLETED
    assert BarrierFamily.WORKFORCE not in {item.barrier_family for item in final.barrier_observations}

    payload = workforce_payload(result)
    assert payload["workforce_designations"][0]["scope"] == "facility"
    assert payload["barrier_observations"] == []
    assert any(
        item["stage"] == "workforce_scope" and item["outcome"] == "scoped_context"
        for item in result["trajectory_events"]
    )


def test_absent_hrsa_observations_are_unknown_coverage_not_evidence_of_adequacy():
    graph = build_county_planning_graph()
    run = run_state("workforce-coverage-unknown")
    result = graph.invoke(
        initial_graph_state(run),
        config=config(run.run_id),
        context=CountyGraphContext(
            public_evidence_package=package(transportation_measure()).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])

    assert final.status == RunStatus.BLOCKED
    assert final.flags.required_sources_complete is False
    assert BarrierFamily.WORKFORCE not in {item.barrier_family for item in final.barrier_observations}
    assert any(
        item["stage"] == "workforce_source_coverage"
        and item["outcome"] == "unknown"
        and "hrsa_observations_absent_source_coverage_not_proven" in item["reason_codes"]
        for item in result["trajectory_events"]
    )

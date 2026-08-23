from datetime import date, datetime, timezone

from cbcap_core.gateway import (
    PublicEvidenceMeasure,
    PublicEvidencePackage,
    SourceCoverageAssertion,
)
from cbcap_core.graph import BranchPayload, CountyGraphContext, build_county_planning_graph, initial_graph_state
from cbcap_core.models import (
    BarrierFamily,
    CountyRunState,
    GeographyKind,
    GeographyRef,
    MetricSemantics,
    PlanDocument,
    ReviewStatus,
    RunStatus,
    SourceVersionRef,
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


def source(source_id: str) -> SourceVersionRef:
    return SourceVersionRef(
        source_id=source_id,
        source_version_id=f"{source_id}:2026-08-22",
        publisher="Official publisher",
        title="Controlled source",
        official_url="https://example.gov/source",
        release_label="2026-08-22",
        release_date=date(2026, 8, 22),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="controlled.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def semantics(source_measure_id: str, *, contextual=False, unit=None) -> MetricSemantics:
    return MetricSemantics(
        id=f"metric:{source_measure_id.lower()}",
        source_measure_id=source_measure_id,
        name=source_measure_id,
        description="Controlled graph workforce fixture.",
        direction="contextual" if contextual else "adverse",
        higher_value_meaning="context_dependent" if contextual else "adverse",
        unit=unit or ("designation" if contextual else "percent"),
        universe="controlled fixture",
        adjustment="not_applicable" if contextual else "modeled",
        comparison_policy="context_only" if contextual else "higher_is_concern",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )


def transportation_measure() -> PublicEvidenceMeasure:
    return PublicEvidenceMeasure(
        id="measure:transportation:36001",
        semantics=semantics("LACKTRPT"),
        geography=county(),
        source_version=source("cdc-places"),
        geography_level="county",
        value=12.5,
        numeric_value=12.5,
        source_metadata={},
        review_status=ReviewStatus.VERIFIED,
    )


def hpsa_measure(*, scope="county", whole_county=True) -> PublicEvidenceMeasure:
    return PublicEvidenceMeasure(
        id=f"measure:hpsa:{scope}:36001",
        semantics=semantics("HPSA_DESIGNATION", contextual=True),
        geography=county(),
        source_version=source("hrsa-workforce"),
        geography_level=scope,
        value="Designated",
        numeric_value=17.0,
        data_period_start=date(2024, 1, 1),
        source_metadata={
            "designationName": "Controlled HPSA",
            "designationType": "Geographic HPSA" if scope == "county" else "Facility HPSA",
            "componentType": "Single County" if scope == "county" else "Federally Qualified Health Center",
            "discipline": "Primary Care",
            "designationStatus": "Designated",
            "lastUpdateDate": "2026-08-20",
            "wholeCountyGeographicDesignation": whole_county,
            "sourceGeographyIdentificationNumber": "36001",
        },
        review_status=ReviewStatus.VERIFIED,
    )


def ahrf_measure() -> PublicEvidenceMeasure:
    ahrf_source = source("ahrf-workforce").model_copy(
        update={
            "source_version_id": "ahrf-workforce:2024-2025",
            "release_label": "2024-2025",
            "release_date": date(2025, 12, 18),
        }
    )
    return PublicEvidenceMeasure(
        id="measure:ahrf:primary-care-physicians:36001",
        semantics=semantics(
            "phys_nf_prim_care_pc_exc_rsdt_23",
            contextual=True,
            unit="count",
        ),
        geography=county(),
        source_version=ahrf_source,
        geography_level="county",
        value=125.0,
        numeric_value=125.0,
        data_period_start=date(2023, 1, 1),
        data_period_end=date(2023, 12, 31),
        source_metadata={"variableYear": 2023},
        review_status=ReviewStatus.VERIFIED,
    )


def coverage(key: str, status: str, records: int) -> SourceCoverageAssertion:
    return SourceCoverageAssertion(
        id=f"coverage:{key}:36001",
        source_id="hrsa-workforce",
        source_version_id=source("hrsa-workforce").source_version_id,
        geography_id=county().id,
        coverage_key=key,
        status=status,
        records_matched=records,
        evaluated_at=NOW,
        review_status=ReviewStatus.VERIFIED,
    )


def hpsa_coverage(*, primary_records: int) -> list[SourceCoverageAssertion]:
    return [
        coverage(
            "hpsa:primary_care",
            "complete_with_records" if primary_records else "complete_no_records",
            primary_records,
        ),
        coverage("hpsa:dental", "complete_no_records", 0),
        coverage("hpsa:mental_health", "complete_no_records", 0),
    ]


def package(
    *,
    hpsa: PublicEvidenceMeasure | None,
    include_ahrf=False,
    include_hpsa_coverage=True,
) -> PublicEvidencePackage:
    measures = [transportation_measure()]
    if hpsa is not None:
        measures.append(hpsa)
    if include_ahrf:
        measures.append(ahrf_measure())

    versions = {item.source_version.source_version_id: item.source_version for item in measures}
    source_coverage: list[SourceCoverageAssertion] = []
    if include_hpsa_coverage:
        hrsa_source = source("hrsa-workforce")
        versions[hrsa_source.source_version_id] = hrsa_source
        source_coverage = hpsa_coverage(primary_records=1 if hpsa is not None else 0)

    return PublicEvidencePackage(
        release_id="controlled-workforce-release",
        generated_at=NOW,
        geographies=[county()],
        metric_semantics=[item.semantics for item in measures],
        measures=measures,
        source_versions=list(versions.values()),
        source_coverage=source_coverage,
    )


def run() -> CountyRunState:
    plan = PlanDocument(
        id="plan:chip:36001",
        source_document_id="document:chip:36001",
        document_type="chip",
        title="Controlled CHIP",
        publisher="County health department",
        geography_ids=[county().id],
        current_plan_status="verified_current",
        review_status=ReviewStatus.VERIFIED,
    )
    return CountyRunState(
        run_id="graph-workforce-run",
        county=county(),
        requested_at=NOW,
        plan_documents=[plan],
    )


def config(thread_id: str) -> dict:
    return {"configurable": {"thread_id": thread_id}}


def workforce_payload(result: dict) -> BranchPayload:
    return next(
        BranchPayload.model_validate(item)
        for item in result["branch_payloads"]
        if item["branch"] == "workforce_designations"
    )


def test_whole_county_hpsa_enters_parent_graph_as_workforce_barrier():
    graph = build_county_planning_graph()
    result = graph.invoke(
        initial_graph_state(run()),
        config=config("whole-county"),
        context=CountyGraphContext(
            public_evidence_package=package(hpsa=hpsa_measure()).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.COMPLETED
    assert {item.barrier_family for item in final.barrier_observations} == {
        BarrierFamily.TRANSPORTATION_TRAVEL,
        BarrierFamily.WORKFORCE,
    }


def test_facility_hpsa_remains_scoped_context_and_never_becomes_county_barrier():
    graph = build_county_planning_graph()
    result = graph.invoke(
        initial_graph_state(run()),
        config=config("facility"),
        context=CountyGraphContext(
            public_evidence_package=package(
                hpsa=hpsa_measure(scope="facility", whole_county=False)
            ).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.COMPLETED
    assert BarrierFamily.WORKFORCE not in {
        item.barrier_family for item in final.barrier_observations
    }
    payload = workforce_payload(result)
    assert len(payload.workforce_designations) == 1
    assert payload.workforce_designations[0].scope == "facility"
    assert any(
        item["stage"] == "workforce_scope" and item["outcome"] == "scoped_context"
        for item in result["trajectory_events"]
    )


def test_verified_zero_record_hpsa_coverage_allows_no_designation_result():
    graph = build_county_planning_graph()
    result = graph.invoke(
        initial_graph_state(run()),
        config=config("verified-zero-hpsa"),
        context=CountyGraphContext(
            public_evidence_package=package(hpsa=None).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.COMPLETED
    assert BarrierFamily.WORKFORCE not in {
        item.barrier_family for item in final.barrier_observations
    }
    assert any(
        item["stage"] == "workforce_source_coverage"
        and item["outcome"] == "complete_no_designations"
        for item in result["trajectory_events"]
    )


def test_ahrf_capacity_is_retained_separately_from_hpsa_shortage():
    graph = build_county_planning_graph()
    result = graph.invoke(
        initial_graph_state(run()),
        config=config("hpsa-plus-ahrf"),
        context=CountyGraphContext(
            public_evidence_package=package(
                hpsa=hpsa_measure(),
                include_ahrf=True,
            ).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.COMPLETED
    payload = workforce_payload(result)
    assert len(payload.workforce_capacity_observations) == 1
    capacity = payload.workforce_capacity_observations[0]
    assert capacity.kind == "primary_care_physicians"
    assert capacity.reference_year == 2023
    assert capacity.source_version_id == "ahrf-workforce:2024-2025"


def test_ahrf_capacity_cannot_substitute_for_missing_hpsa_coverage():
    graph = build_county_planning_graph()
    result = graph.invoke(
        initial_graph_state(run()),
        config=config("ahrf-without-hpsa-coverage"),
        context=CountyGraphContext(
            public_evidence_package=package(
                hpsa=None,
                include_ahrf=True,
                include_hpsa_coverage=False,
            ).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.BLOCKED
    assert final.flags.required_sources_complete is False
    assert final.flags.safe_to_publish is False
    payload = workforce_payload(result)
    assert len(payload.workforce_capacity_observations) == 1
    assert any(
        item["stage"] == "workforce_source_coverage"
        and item["outcome"] == "incomplete"
        for item in result["trajectory_events"]
    )

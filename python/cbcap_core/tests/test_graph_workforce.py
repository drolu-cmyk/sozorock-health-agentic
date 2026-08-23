from datetime import date, datetime, timezone

from cbcap_core.gateway import PublicEvidenceMeasure, PublicEvidencePackage
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


def semantics(source_measure_id: str, *, contextual=False) -> MetricSemantics:
    return MetricSemantics(
        id=f"metric:{source_measure_id.lower()}",
        source_measure_id=source_measure_id,
        name=source_measure_id,
        description="Controlled graph workforce fixture.",
        direction="contextual" if contextual else "adverse",
        higher_value_meaning="context_dependent" if contextual else "adverse",
        unit="designation" if contextual else "percent",
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


def package(*, hpsa: PublicEvidenceMeasure | None) -> PublicEvidencePackage:
    measures = [transportation_measure()]
    if hpsa is not None:
        measures.append(hpsa)
    versions = {item.source_version.source_version_id: item.source_version for item in measures}
    return PublicEvidencePackage(
        release_id="controlled-workforce-release",
        generated_at=NOW,
        geographies=[county()],
        metric_semantics=[item.semantics for item in measures],
        measures=measures,
        source_versions=list(versions.values()),
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
    workforce_payload = next(
        BranchPayload.model_validate(item)
        for item in result["branch_payloads"]
        if item["branch"] == "workforce_designations"
    )
    assert len(workforce_payload.workforce_designations) == 1
    assert workforce_payload.workforce_designations[0].scope == "facility"
    assert any(
        item["stage"] == "workforce_scope" and item["outcome"] == "scoped_context"
        for item in result["trajectory_events"]
    )


def test_missing_hrsa_observations_blocks_graph_instead_of_claiming_no_shortage():
    graph = build_county_planning_graph()
    result = graph.invoke(
        initial_graph_state(run()),
        config=config("missing-hrsa"),
        context=CountyGraphContext(
            public_evidence_package=package(hpsa=None).model_dump(mode="json")
        ),
    )
    final = CountyRunState.model_validate(result["county_run"])
    assert final.status == RunStatus.BLOCKED
    assert final.flags.required_sources_complete is False
    assert final.flags.safe_to_publish is False
    assert any(
        "hrsa_observations_absent_source_coverage_not_proven" in item["reason_codes"]
        for item in result["trajectory_events"]
    )

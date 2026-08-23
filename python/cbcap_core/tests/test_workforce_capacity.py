from datetime import date, datetime, timezone

from cbcap_core.gateway import PublicEvidenceMeasure
from cbcap_core.models import (
    GeographyKind,
    GeographyRef,
    MetricSemantics,
    ReviewStatus,
    SourceVersionRef,
)
from cbcap_core.workforce_capacity import (
    classify_ahrf_capacity_measure,
    classify_ahrf_capacity_measures,
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


def source() -> SourceVersionRef:
    return SourceVersionRef(
        source_id="ahrf-workforce",
        source_version_id="ahrf-workforce:2024-2025",
        publisher="Health Resources and Services Administration, Bureau of Health Workforce",
        title="Area Health Resources Files",
        official_url="https://data.hrsa.gov/data/download?data=AHRF",
        release_label="2024-2025",
        release_date=date(2025, 12, 18),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="ahrf.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def measure(
    source_measure_id="phys_nf_prim_care_pc_exc_rsdt_23",
    *,
    reference_year=2023,
    geography_level="county",
    source_id="ahrf-workforce",
) -> PublicEvidenceMeasure:
    semantics = MetricSemantics(
        id=f"metric:{source_measure_id}",
        source_measure_id=source_measure_id,
        name="Controlled AHRF capacity variable",
        description="Controlled AHRF workforce capacity fixture.",
        direction="contextual",
        higher_value_meaning="context_dependent",
        unit="count",
        universe="county workforce capacity context",
        adjustment="not_applicable",
        comparison_policy="context_only",
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    src = source().model_copy(update={"source_id": source_id})
    return PublicEvidenceMeasure(
        id=f"measure:{source_measure_id}:36001",
        semantics=semantics,
        geography=county(),
        source_version=src,
        geography_level=geography_level,
        value=125.0,
        numeric_value=125.0,
        data_period_start=date(reference_year, 1, 1),
        data_period_end=date(reference_year, 12, 31),
        source_metadata={"variableYear": reference_year},
        review_status=ReviewStatus.VERIFIED,
    )


def test_ahrf_reference_year_is_variable_year_not_release_year():
    decision = classify_ahrf_capacity_measure(measure())
    assert decision.status == "admitted"
    assert decision.observation is not None
    assert decision.observation.reference_year == 2023
    assert decision.observation.source_version_id == "ahrf-workforce:2024-2025"
    assert "does not by itself establish shortage" in decision.observation.interpretation_boundary


def test_ahrf_variable_year_mismatch_fails_closed():
    decision = classify_ahrf_capacity_measure(measure(reference_year=2024))
    assert decision.status == "rejected"
    assert "ahrf_variable_year_mismatch" in decision.reason_codes


def test_ahrf_capacity_requires_county_scope():
    decision = classify_ahrf_capacity_measure(measure(geography_level="facility"))
    assert decision.status == "rejected"
    assert "ahrf_capacity_requires_county_scope" in decision.reason_codes


def test_ahrf_capacity_cannot_be_relabelled_from_another_source():
    decision = classify_ahrf_capacity_measure(measure(source_id="hrsa-workforce"))
    assert decision.status == "rejected"
    assert "not_ahrf_workforce_source" in decision.reason_codes


def test_approved_ahrf_variables_remain_separate_capacity_observations():
    primary_care = measure()
    nhsc_sites = measure(
        source_measure_id="nhsc_prim_care_sites_24",
        reference_year=2024,
    )
    result = classify_ahrf_capacity_measures([primary_care, nhsc_sites])
    assert len(result.observations) == 2
    assert {item.kind for item in result.observations} == {
        "primary_care_physicians",
        "nhsc_primary_care_sites",
    }
    assert {item.reference_year for item in result.observations} == {2023, 2024}

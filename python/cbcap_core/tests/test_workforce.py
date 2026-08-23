from datetime import date, datetime, timezone

from cbcap_core.gateway import PublicEvidenceMeasure
from cbcap_core.models import (
    BarrierFamily,
    GeographyKind,
    GeographyRef,
    MetricSemantics,
    ReviewStatus,
    SourceVersionRef,
)
from cbcap_core.workforce import classify_workforce_measure, classify_workforce_measures

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


def source() -> SourceVersionRef:
    return SourceVersionRef(
        source_id="hrsa-workforce",
        source_version_id="hrsa-workforce:2026-08-22",
        publisher="Health Resources and Services Administration",
        title="Health Professional Shortage Areas",
        official_url="https://data.hrsa.gov/",
        release_label="2026-08-22",
        release_date=date(2026, 8, 22),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="hrsa-hpsa.csv.v2",
        review_status=ReviewStatus.VERIFIED,
    )


def semantics() -> MetricSemantics:
    return MetricSemantics(
        id="measure:hpsa-designation",
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


def measure(
    *,
    geography_level="county",
    whole_county=True,
    component_type="Single County",
    designation_type="Geographic HPSA",
    discipline="Primary Care",
) -> PublicEvidenceMeasure:
    return PublicEvidenceMeasure(
        id=f"observation:hpsa:{geography_level}",
        semantics=semantics(),
        geography=county(),
        source_version=source(),
        geography_level=geography_level,
        value="Designated",
        numeric_value=17.0,
        data_period_start=date(2024, 1, 1),
        review_status=ReviewStatus.VERIFIED,
        source_metadata={
            "designationName": "Albany County Primary Care HPSA",
            "designationType": designation_type,
            "componentType": component_type,
            "discipline": discipline,
            "designationStatus": "Designated",
            "lastUpdateDate": "2026-08-20",
            "wholeCountyGeographicDesignation": whole_county,
            "sourceGeographyIdentificationNumber": "36001",
        },
    )


def test_whole_county_hpsa_requires_both_scope_and_source_confirmation():
    decision = classify_workforce_measure(measure())
    assert decision.status == "admitted"
    assert decision.designation is not None
    assert decision.designation.scope == "county"
    assert decision.designation.is_whole_county is True
    assert decision.designation.discipline == "primary_care"
    assert decision.county_barrier_observation is not None
    assert decision.county_barrier_observation.barrier_family == BarrierFamily.WORKFORCE
    assert decision.county_barrier_observation.pressure_percentile is None


def test_population_group_designation_remains_context_and_not_county_barrier():
    decision = classify_workforce_measure(
        measure(
            geography_level="population_group",
            whole_county=False,
            component_type="Low Income Population",
            designation_type="Population HPSA",
        )
    )
    assert decision.status == "admitted"
    assert decision.designation is not None
    assert decision.designation.scope == "population_group"
    assert decision.designation.is_whole_county is False
    assert decision.county_barrier_observation is None


def test_facility_designation_is_not_promoted_to_county_shortage():
    decision = classify_workforce_measure(
        measure(
            geography_level="facility",
            whole_county=False,
            component_type="Federally Qualified Health Center",
            designation_type="Facility HPSA",
        )
    )
    assert decision.status == "admitted"
    assert decision.designation is not None
    assert decision.designation.scope == "facility"
    assert decision.designation.is_whole_county is False
    assert decision.county_barrier_observation is None


def test_county_scope_without_source_confirmation_fails_closed():
    decision = classify_workforce_measure(measure(whole_county=False))
    assert decision.status == "rejected"
    assert "county_scope_not_confirmed_by_source" in decision.reason_codes


def test_missing_observation_scope_fails_closed():
    candidate = measure().model_copy(update={"geography_level": None})
    decision = classify_workforce_measure(candidate)
    assert decision.status == "rejected"
    assert "observation_scope_missing" in decision.reason_codes


def test_batch_keeps_scoped_designations_but_only_whole_county_creates_barrier():
    county_designation = measure()
    facility_designation = measure(
        geography_level="facility",
        whole_county=False,
        component_type="Federally Qualified Health Center",
        designation_type="Facility HPSA",
        discipline="Mental Health",
    ).model_copy(update={"id": "observation:hpsa:facility:mental"})
    result = classify_workforce_measures([county_designation, facility_designation])
    assert len(result.designations) == 2
    assert {item.scope for item in result.designations} == {"county", "facility"}
    assert len(result.county_barrier_observations) == 1
    assert result.county_barrier_observations[0].measure_id == county_designation.id

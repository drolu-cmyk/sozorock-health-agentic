from datetime import date, datetime, timezone

import pytest
from pydantic import ValidationError

from cbcap_core import (
    CountyRunState,
    GeographyKind,
    GeographyRef,
    Measure,
    MetricSemantics,
    PublicEvidencePackage,
    ReviewStatus,
    SourceVersionRef,
    WorkflowFlags,
)


NOW = datetime(2026, 8, 22, 22, 0, tzinfo=timezone.utc)


def county() -> GeographyRef:
    return GeographyRef(
        id="geo:county:36001",
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
        source_id="cdc_places",
        source_version_id="cdc_places:2025",
        publisher="Centers for Disease Control and Prevention",
        title="PLACES",
        official_url="https://www.cdc.gov/places/",
        release_label="2025",
        release_date=date(2025, 12, 1),
        retrieved_at=NOW,
        content_hash="1234567890abcdef1234567890abcdef",
        schema_version="public-evidence-v1",
        review_status=ReviewStatus.VERIFIED,
    )


def semantics() -> MetricSemantics:
    return MetricSemantics(
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
        trendable=True,
        forecastable=False,
        aggregatable=False,
        allowed_geography_kinds=[GeographyKind.COUNTY],
        allowed_visualizations=["choropleth", "ranked_dot", "distribution"],
        review_status=ReviewStatus.VERIFIED,
    )


def measure() -> Measure:
    return Measure(
        id="measure:transportation:36001:2025",
        semantics=semantics(),
        geography=county(),
        source_version=source(),
        value=8.1,
        numeric_value=8.1,
        review_status=ReviewStatus.VERIFIED,
    )


def test_county_state_requires_county_geography():
    state_geo = GeographyRef(
        id="geo:state:36",
        kind=GeographyKind.STATE,
        authority="census",
        authority_id="36",
        name="New York",
        display_name="New York",
        state_fips="36",
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )

    with pytest.raises(ValidationError):
        CountyRunState(
            run_id="run-1",
            county=state_geo,
            requested_at=NOW,
        )


def test_safe_to_publish_is_state_controlled():
    with pytest.raises(ValidationError):
        CountyRunState(
            run_id="run-1",
            county=county(),
            requested_at=NOW,
            flags=WorkflowFlags(safe_to_publish=True),
        )

    flags = WorkflowFlags(
        geography_verified=True,
        required_sources_complete=True,
        evidence_validated=True,
        policy_passed=True,
        safe_to_publish=True,
    )
    state = CountyRunState(
        run_id="run-2",
        county=county(),
        requested_at=NOW,
        flags=flags,
    )
    assert state.flags.publication_preconditions_met()


def test_public_gateway_rejects_private_fields():
    payload = {
        "release_id": "release-2026-08-22",
        "generated_at": NOW,
        "geographies": [county().model_dump()],
        "metric_semantics": [semantics().model_dump()],
        "measures": [measure().model_dump()],
        "source_versions": [source().model_dump()],
        "tenant_id": "must-not-leak",
    }

    with pytest.raises(ValidationError):
        PublicEvidencePackage.model_validate(payload)


def test_public_fact_retains_value_and_provenance():
    package = PublicEvidencePackage(
        release_id="release-2026-08-22",
        generated_at=NOW,
        geographies=[county()],
        metric_semantics=[semantics()],
        measures=[measure()],
        source_versions=[source()],
    )

    item = package.measures[0]
    assert item.numeric_value == 8.1
    assert item.source_version.source_id == "cdc_places"
    assert item.source_version.content_hash == "1234567890abcdef1234567890abcdef"
    assert item.geography.county_fips == "36001"


def test_unknown_contract_fields_fail_closed():
    with pytest.raises(ValidationError):
        GeographyRef.model_validate(
            {
                **county().model_dump(),
                "private_planning_note": "should never cross the public boundary",
            }
        )


EVALUATION_COUNTIES = [
    ("36001", "36", "Albany County, New York"),
    ("36093", "36", "Schenectady County, New York"),
    ("36057", "36", "Montgomery County, New York"),
    ("42029", "42", "Chester County, Pennsylvania"),
    ("48029", "48", "Bexar County, Texas"),
]


@pytest.mark.parametrize("county_fips,state_fips,display_name", EVALUATION_COUNTIES)
def test_initial_evaluation_counties_fit_canonical_state(
    county_fips: str,
    state_fips: str,
    display_name: str,
):
    geography = GeographyRef(
        id=f"geo:county:{county_fips}",
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id=county_fips,
        name=display_name.split(",")[0],
        display_name=display_name,
        state_fips=state_fips,
        county_fips=county_fips,
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )

    state = CountyRunState(
        run_id=f"evaluation:{county_fips}",
        county=geography,
        requested_at=NOW,
    )

    assert state.county.county_fips == county_fips
    assert state.schema_version == "cbcap.county-run.v1"

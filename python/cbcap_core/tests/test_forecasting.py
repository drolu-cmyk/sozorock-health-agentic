from datetime import date, datetime, timezone

from cbcap_core.forecasting import authorize_forecast, build_scenario_projection
from cbcap_core.models import (
    GeographyKind,
    GeographyRef,
    Measure,
    MetricSemantics,
    ReviewStatus,
    ScenarioAssumption,
    SourceVersionRef,
)

NOW = datetime(2026, 8, 22, 22, 45, tzinfo=timezone.utc)


def county(fips: str = "36001") -> GeographyRef:
    return GeographyRef(
        id=f"county:{fips}",
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id=fips,
        name="Test County",
        display_name="Test County",
        state_fips=fips[:2],
        county_fips=fips,
        vintage="2025",
        review_status=ReviewStatus.VERIFIED,
    )


def semantics(*, forecastable: bool = True, trendable: bool = True) -> MetricSemantics:
    return MetricSemantics(
        id="metric:transportation",
        source_measure_id="LACKTRPT",
        name="Lack of reliable transportation",
        description="Controlled planning forecast test measure.",
        direction="adverse",
        higher_value_meaning="adverse",
        unit="percent",
        universe="adults",
        adjustment="modeled",
        comparison_policy="higher_is_concern",
        trendable=trendable,
        forecastable=forecastable,
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )


def source(year: int, *, schema_version: str = "places.v1") -> SourceVersionRef:
    return SourceVersionRef(
        source_id="cdc-places",
        source_version_id=f"cdc-places:{year}",
        publisher="Centers for Disease Control and Prevention",
        title="PLACES",
        official_url="https://www.cdc.gov/places/",
        release_label=str(year),
        release_date=date(year, 12, 1),
        data_period_start=date(year, 1, 1),
        data_period_end=date(year, 12, 31),
        retrieved_at=NOW,
        content_hash="sha256:" + str(year).ljust(64, "a"),
        schema_version=schema_version,
        review_status=ReviewStatus.VERIFIED,
    )


def measure(
    year: int,
    value: float,
    *,
    geography: GeographyRef | None = None,
    metric_semantics: MetricSemantics | None = None,
    review_status: ReviewStatus = ReviewStatus.VERIFIED,
) -> Measure:
    return Measure(
        id=f"measure:transportation:{geography.id if geography else 'county:36001'}:{year}",
        semantics=metric_semantics or semantics(),
        geography=geography or county(),
        source_version=source(year),
        geography_level="county",
        value=value,
        numeric_value=value,
        data_period_start=date(year, 1, 1),
        data_period_end=date(year, 12, 31),
        review_status=review_status,
    )


def historical_series() -> list[Measure]:
    return [
        measure(2022, 8.0),
        measure(2023, 8.7),
        measure(2024, 9.2),
        measure(2025, 9.5),
    ]


def assumption(
    *,
    assumption_type: str = "absolute_change",
    value: float = -1.5,
    unit: str = "percent",
    geography_id: str = "county:36001",
    measure_id: str = "measure:transportation:county:36001:2025",
) -> ScenarioAssumption:
    return ScenarioAssumption(
        id="assumption:transportation:1",
        geography_id=geography_id,
        measure_id=measure_id,
        assumption_type=assumption_type,
        value=value,
        unit=unit,
        rationale="Evaluate the effect of an explicit planning assumption.",
        created_by="planner:test",
    )


def test_forecast_authorization_accepts_verified_comparable_series():
    decision = authorize_forecast(historical_series())
    assert decision.status == "ready"
    assert decision.reason_codes == []
    assert decision.comparable_measure_ids == [item.id for item in historical_series()]


def test_forecast_authorization_blocks_metric_not_marked_forecastable():
    nonforecastable = semantics(forecastable=False)
    series = [measure(year, 8.0 + index, metric_semantics=nonforecastable) for index, year in enumerate(range(2022, 2026))]
    decision = authorize_forecast(series)
    assert decision.status == "blocked"
    assert "metric_not_forecastable" in decision.reason_codes


def test_forecast_authorization_blocks_mixed_geographies_and_unverified_observations():
    series = historical_series()
    series[2] = measure(2024, 9.2, geography=county("42029"))
    series[3] = measure(2025, 9.5, review_status=ReviewStatus.PROVISIONAL)
    decision = authorize_forecast(series)
    assert decision.status == "blocked"
    assert "mixed_geographies" in decision.reason_codes
    assert "unverified_observation" in decision.reason_codes


def test_forecast_authorization_blocks_duplicate_analysis_period_even_across_releases():
    series = historical_series()
    duplicate = series[-1].model_copy(
        update={
            "id": "measure:transportation:duplicate:2025",
            "source_version": source(2026),
        }
    )
    duplicate = duplicate.model_copy(
        update={
            "data_period_start": date(2025, 1, 1),
            "data_period_end": date(2025, 12, 31),
        }
    )
    decision = authorize_forecast([*series, duplicate])
    assert decision.status == "blocked"
    assert "duplicate_time_position" in decision.reason_codes


def test_absolute_change_scenario_is_transparent_and_provisional():
    baseline = historical_series()[-1]
    decision = build_scenario_projection(
        baseline,
        assumption(),
        horizon_end=date(2027, 12, 31),
    )
    assert decision.status == "ready"
    assert decision.forecast is not None
    assert decision.forecast.point_estimate == 8.0
    assert decision.forecast.review_status == ReviewStatus.PROVISIONAL
    assert decision.forecast.forecast_type == "scenario_projection"
    assert any("not a statistical prediction" in item.lower() for item in decision.forecast.limitations)


def test_relative_change_scenario_accepts_percent_change():
    baseline = historical_series()[-1]
    decision = build_scenario_projection(
        baseline,
        assumption(
            assumption_type="relative_change",
            value=-10.0,
            unit="percent_change",
        ),
        horizon_end=date(2027, 12, 31),
    )
    assert decision.status == "ready"
    assert decision.forecast is not None
    assert round(decision.forecast.point_estimate or 0, 3) == 8.55


def test_scenario_result_outside_percentage_domain_is_blocked_not_clamped():
    baseline = historical_series()[-1]
    decision = build_scenario_projection(
        baseline,
        assumption(value=100.0),
        horizon_end=date(2027, 12, 31),
    )
    assert decision.status == "blocked"
    assert decision.reason_codes == ["scenario_result_outside_metric_domain"]


def test_trend_continuation_requires_an_approved_forecast_adapter():
    baseline = historical_series()[-1]
    decision = build_scenario_projection(
        baseline,
        assumption(
            assumption_type="trend_continuation",
            value=1.0,
            unit="percent",
        ),
        horizon_end=date(2027, 12, 31),
    )
    assert decision.status == "blocked"
    assert "assumption_requires_domain_adapter" in decision.reason_codes


def test_scenario_cannot_cross_geography_boundary():
    baseline = historical_series()[-1]
    decision = build_scenario_projection(
        baseline,
        assumption(geography_id="county:42029"),
        horizon_end=date(2027, 12, 31),
    )
    assert decision.status == "blocked"
    assert "assumption_geography_mismatch" in decision.reason_codes

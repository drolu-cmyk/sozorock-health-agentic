from __future__ import annotations

from datetime import date
from typing import Literal, Protocol

from pydantic import Field

from .models import (
    ForecastResult,
    Measure,
    ReviewStatus,
    ScenarioAssumption,
    StrictModel,
)


ForecastAuthorizationStatus = Literal["ready", "blocked"]
ScenarioProjectionStatus = Literal["ready", "blocked"]


class ForecastAuthorizationDecision(StrictModel):
    status: ForecastAuthorizationStatus
    reason_codes: list[str] = Field(default_factory=list)
    comparable_measure_ids: list[str] = Field(default_factory=list)
    limitations: list[str] = Field(default_factory=list)


class ScenarioProjectionDecision(StrictModel):
    status: ScenarioProjectionStatus
    reason_codes: list[str] = Field(default_factory=list)
    forecast: ForecastResult | None = None


class ForecastModelAdapter(Protocol):
    """Provider-neutral contract for a future approved statistical forecast model.

    Adapters are expected to provide their own backtesting and interval methodology.
    The core package only authorizes inputs and records outputs; it does not silently
    choose a statistical model.
    """

    model_version: str

    def project(
        self,
        *,
        measures: list[Measure],
        horizon_end: date,
    ) -> ForecastResult: ...


def _period_key(measure: Measure) -> tuple[date | None, date | None, date]:
    return (
        measure.data_period_start,
        measure.data_period_end,
        measure.source_version.release_date,
    )


def authorize_forecast(
    measures: list[Measure],
    *,
    minimum_points: int = 4,
) -> ForecastAuthorizationDecision:
    """Authorize a comparable historical series for a future forecast adapter.

    Authorization is deliberately stricter than visualization. A metric can be
    trendable without being forecastable. All observations must be verified,
    numeric, share one geography and one semantic definition, and have unique
    temporal positions.
    """

    reasons: list[str] = []
    limitations: list[str] = []

    if len(measures) < minimum_points:
        reasons.append("insufficient_time_points")

    if not measures:
        return ForecastAuthorizationDecision(
            status="blocked",
            reason_codes=sorted(set(reasons or ["no_measures"])),
        )

    first = measures[0]
    if first.semantics.review_status != ReviewStatus.VERIFIED:
        reasons.append("metric_semantics_not_verified")
    if not first.semantics.trendable:
        reasons.append("metric_not_trendable")
    if not first.semantics.forecastable:
        reasons.append("metric_not_forecastable")

    geography_ids = {item.geography.id for item in measures}
    if len(geography_ids) != 1:
        reasons.append("mixed_geographies")

    semantics_ids = {item.semantics.id for item in measures}
    if len(semantics_ids) != 1:
        reasons.append("mixed_metric_semantics")

    units = {item.semantics.unit for item in measures}
    if len(units) != 1:
        reasons.append("mixed_units")

    adjustments = {item.semantics.adjustment for item in measures}
    if len(adjustments) != 1:
        reasons.append("mixed_adjustments")

    if any(item.review_status != ReviewStatus.VERIFIED for item in measures):
        reasons.append("unverified_observation")
    if any(item.source_version.review_status != ReviewStatus.VERIFIED for item in measures):
        reasons.append("unverified_source_version")
    if any(item.numeric_value is None for item in measures):
        reasons.append("nonnumeric_observation")

    period_keys = [_period_key(item) for item in measures]
    if len(period_keys) != len(set(period_keys)):
        reasons.append("duplicate_time_position")

    source_measure_ids = {item.semantics.source_measure_id for item in measures}
    if len(source_measure_ids) != 1:
        reasons.append("source_measure_changed")

    if len({item.source_version.schema_version for item in measures}) > 1:
        limitations.append(
            "Source schema versions differ across the candidate series and require explicit comparability review."
        )
    if len({item.source_version.source_id for item in measures}) > 1:
        limitations.append(
            "Multiple source families contribute to the candidate series and require explicit comparability review."
        )

    if reasons:
        return ForecastAuthorizationDecision(
            status="blocked",
            reason_codes=sorted(set(reasons)),
            limitations=limitations,
        )

    return ForecastAuthorizationDecision(
        status="ready",
        comparable_measure_ids=[
            item.id for item in sorted(measures, key=_period_key)
        ],
        limitations=limitations,
    )


def _percentage_domain(measure: Measure, value: float) -> bool:
    if measure.semantics.unit != "percent":
        return True
    return 0.0 <= value <= 100.0


def build_scenario_projection(
    baseline: Measure,
    assumption: ScenarioAssumption,
    *,
    horizon_end: date,
    model_version: str = "cbcap-deterministic-scenario-v1",
) -> ScenarioProjectionDecision:
    """Apply a transparent planning assumption to one verified baseline measure.

    This is scenario arithmetic, not a prediction. Unsupported assumptions are
    blocked until a domain-specific adapter exists. Outputs remain provisional
    until a governed review promotes them.
    """

    reasons: list[str] = []
    if baseline.review_status != ReviewStatus.VERIFIED:
        reasons.append("baseline_not_verified")
    if baseline.source_version.review_status != ReviewStatus.VERIFIED:
        reasons.append("baseline_source_not_verified")
    if baseline.semantics.review_status != ReviewStatus.VERIFIED:
        reasons.append("metric_semantics_not_verified")
    if not baseline.semantics.forecastable:
        reasons.append("metric_not_forecastable")
    if baseline.numeric_value is None:
        reasons.append("baseline_not_numeric")
    if assumption.geography_id != baseline.geography.id:
        reasons.append("assumption_geography_mismatch")
    if assumption.measure_id not in {baseline.id, baseline.semantics.id}:
        reasons.append("assumption_measure_mismatch")
    if horizon_end <= baseline.source_version.release_date:
        reasons.append("forecast_horizon_not_future")

    if assumption.assumption_type == "absolute_change":
        if assumption.unit != baseline.semantics.unit:
            reasons.append("absolute_change_unit_mismatch")
    elif assumption.assumption_type == "relative_change":
        if assumption.unit not in {"fraction", "percent_change"}:
            reasons.append("relative_change_unit_invalid")
    elif assumption.assumption_type in {"capacity_change", "trend_continuation", "custom"}:
        reasons.append("assumption_requires_domain_adapter")
    else:
        reasons.append("unsupported_assumption_type")

    if reasons:
        return ScenarioProjectionDecision(
            status="blocked",
            reason_codes=sorted(set(reasons)),
        )

    baseline_value = float(baseline.numeric_value)
    if assumption.assumption_type == "absolute_change":
        projected = baseline_value + assumption.value
    else:
        relative = assumption.value / 100.0 if assumption.unit == "percent_change" else assumption.value
        projected = baseline_value * (1.0 + relative)

    if not _percentage_domain(baseline, projected):
        return ScenarioProjectionDecision(
            status="blocked",
            reason_codes=["scenario_result_outside_metric_domain"],
        )

    forecast = ForecastResult(
        id=f"forecast:scenario:{baseline.id}:{assumption.id}:{horizon_end.isoformat()}",
        geography_id=baseline.geography.id,
        measure_id=baseline.id,
        forecast_type="scenario_projection",
        model_version=model_version,
        horizon_end=horizon_end,
        point_estimate=projected,
        interval_low=None,
        interval_high=None,
        assumption_ids=[assumption.id],
        input_measure_ids=[baseline.id],
        limitations=[
            "This is a deterministic planning scenario, not a statistical prediction.",
            "The result changes only the stated assumption and does not model secondary effects.",
            "No probability of occurrence is implied.",
        ],
        backtest_reference=None,
        review_status=ReviewStatus.PROVISIONAL,
    )
    return ScenarioProjectionDecision(status="ready", forecast=forecast)

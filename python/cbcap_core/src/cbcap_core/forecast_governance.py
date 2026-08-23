from __future__ import annotations

from datetime import date, datetime
from math import sqrt
from typing import Literal

from pydantic import Field, model_validator

from .models import ReviewStatus, StrictModel

ForecastModelFamily = Literal["statistical", "deterministic_scenario"]
ForecastApprovalDecision = Literal["approved", "rejected", "suspended"]
BacktestPolicyStatus = Literal["passes", "blocked"]
ModelExecutionStatus = Literal["ready", "blocked"]


class ForecastModelRegistration(StrictModel):
    """Immutable registration for one executable forecast implementation version."""

    model_version: str = Field(min_length=1)
    model_family: ForecastModelFamily
    implementation_ref: str = Field(min_length=1)
    implementation_hash: str = Field(pattern=r"^sha256:[0-9a-fA-F]{64}$")
    supported_metric_semantics_ids: list[str] = Field(min_length=1)
    allowed_source_ids: list[str] = Field(min_length=1)
    minimum_points: int = Field(default=4, ge=2)
    maximum_horizon_days: int = Field(gt=0)
    intervals_required: bool = True
    registered_by: str = Field(min_length=1)
    registered_at: datetime

    @model_validator(mode="after")
    def validate_registration(self) -> "ForecastModelRegistration":
        if len(set(self.supported_metric_semantics_ids)) != len(self.supported_metric_semantics_ids):
            raise ValueError("supported metric semantics IDs must be unique")
        if len(set(self.allowed_source_ids)) != len(self.allowed_source_ids):
            raise ValueError("allowed source IDs must be unique")
        return self


class ForecastBacktestCase(StrictModel):
    id: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    metric_semantics_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    forecast_origin: date
    horizon_end: date
    training_measure_ids: list[str] = Field(min_length=1)
    holdout_measure_id: str = Field(min_length=1)
    predicted_value: float
    actual_value: float
    interval_low: float | None = None
    interval_high: float | None = None
    executed_at: datetime
    input_state_hash: str = Field(pattern=r"^sha256:[0-9a-fA-F]{64}$")

    @model_validator(mode="after")
    def validate_case(self) -> "ForecastBacktestCase":
        if self.horizon_end <= self.forecast_origin:
            raise ValueError("backtest horizon must be future to forecast origin")
        if (self.interval_low is None) != (self.interval_high is None):
            raise ValueError("backtest interval requires both lower and upper bounds")
        if self.interval_low is not None and self.interval_high is not None:
            if self.interval_low > self.interval_high:
                raise ValueError("backtest interval lower bound cannot exceed upper bound")
        if self.holdout_measure_id in self.training_measure_ids:
            raise ValueError("holdout observation cannot also be a training observation")
        if len(set(self.training_measure_ids)) != len(self.training_measure_ids):
            raise ValueError("training measure IDs must be unique")
        return self

    @property
    def signed_error(self) -> float:
        return self.predicted_value - self.actual_value

    @property
    def absolute_error(self) -> float:
        return abs(self.signed_error)

    @property
    def squared_error(self) -> float:
        return self.signed_error ** 2

    @property
    def interval_hit(self) -> bool | None:
        if self.interval_low is None or self.interval_high is None:
            return None
        return self.interval_low <= self.actual_value <= self.interval_high

    @property
    def horizon_days(self) -> int:
        return (self.horizon_end - self.forecast_origin).days


class ForecastBacktestSummary(StrictModel):
    id: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    metric_semantics_id: str = Field(min_length=1)
    case_count: int = Field(gt=0)
    geography_count: int = Field(gt=0)
    mean_absolute_error: float = Field(ge=0)
    root_mean_squared_error: float = Field(ge=0)
    mean_signed_error: float
    maximum_absolute_error: float = Field(ge=0)
    interval_case_count: int = Field(ge=0)
    interval_coverage: float | None = Field(default=None, ge=0, le=1)
    minimum_horizon_days: int = Field(gt=0)
    maximum_horizon_days: int = Field(gt=0)
    backtest_case_ids: list[str] = Field(min_length=1)
    computed_at: datetime
    review_status: ReviewStatus = ReviewStatus.PROVISIONAL


class ForecastBacktestPolicy(StrictModel):
    """Metric-specific acceptance policy. Thresholds are explicit, never global magic numbers."""

    id: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    metric_semantics_id: str = Field(min_length=1)
    minimum_cases: int = Field(gt=0)
    maximum_mean_absolute_error: float | None = Field(default=None, ge=0)
    maximum_root_mean_squared_error: float | None = Field(default=None, ge=0)
    maximum_absolute_mean_signed_error: float | None = Field(default=None, ge=0)
    minimum_interval_coverage: float | None = Field(default=None, ge=0, le=1)
    intervals_required: bool = True
    maximum_horizon_days: int = Field(gt=0)
    rationale: str = Field(min_length=1)
    reviewed_by: str = Field(min_length=1)
    reviewed_at: datetime
    review_status: ReviewStatus = ReviewStatus.VERIFIED


class BacktestPolicyEvaluation(StrictModel):
    status: BacktestPolicyStatus
    model_version: str = Field(min_length=1)
    metric_semantics_id: str = Field(min_length=1)
    summary_id: str = Field(min_length=1)
    policy_id: str = Field(min_length=1)
    reason_codes: list[str] = Field(default_factory=list)


class ForecastModelApproval(StrictModel):
    """Human governance decision. This is distinct from deterministic policy evaluation."""

    id: str = Field(min_length=1)
    model_version: str = Field(min_length=1)
    metric_semantics_id: str = Field(min_length=1)
    policy_id: str = Field(min_length=1)
    backtest_summary_id: str = Field(min_length=1)
    decision: ForecastApprovalDecision
    reason_codes: list[str] = Field(min_length=1)
    decided_by: str = Field(min_length=1)
    decided_at: datetime
    valid_from: date
    valid_until: date | None = None
    review_status: ReviewStatus = ReviewStatus.VERIFIED

    @model_validator(mode="after")
    def validate_validity(self) -> "ForecastModelApproval":
        if self.valid_until is not None and self.valid_until < self.valid_from:
            raise ValueError("forecast model approval valid_until cannot precede valid_from")
        return self


class ForecastModelExecutionDecision(StrictModel):
    status: ModelExecutionStatus
    reason_codes: list[str] = Field(default_factory=list)
    model_version: str = Field(min_length=1)
    metric_semantics_id: str = Field(min_length=1)
    backtest_summary_id: str | None = None
    approval_id: str | None = None


def summarize_backtests(
    cases: list[ForecastBacktestCase],
    *,
    computed_at: datetime,
) -> ForecastBacktestSummary:
    if not cases:
        raise ValueError("at least one backtest case is required")
    if len({item.id for item in cases}) != len(cases):
        raise ValueError("backtest case IDs must be unique")
    if len({item.model_version for item in cases}) != 1:
        raise ValueError("backtest summary cannot mix model versions")
    if len({item.metric_semantics_id for item in cases}) != 1:
        raise ValueError("backtest summary cannot mix metric semantics")

    case_count = len(cases)
    abs_errors = [item.absolute_error for item in cases]
    squared_errors = [item.squared_error for item in cases]
    signed_errors = [item.signed_error for item in cases]
    interval_results = [item.interval_hit for item in cases if item.interval_hit is not None]
    model_version = cases[0].model_version
    metric_semantics_id = cases[0].metric_semantics_id
    stable_ids = sorted(item.id for item in cases)

    return ForecastBacktestSummary(
        id=f"backtest-summary:{model_version}:{metric_semantics_id}:{computed_at.isoformat()}",
        model_version=model_version,
        metric_semantics_id=metric_semantics_id,
        case_count=case_count,
        geography_count=len({item.geography_id for item in cases}),
        mean_absolute_error=sum(abs_errors) / case_count,
        root_mean_squared_error=sqrt(sum(squared_errors) / case_count),
        mean_signed_error=sum(signed_errors) / case_count,
        maximum_absolute_error=max(abs_errors),
        interval_case_count=len(interval_results),
        interval_coverage=(
            sum(1 for item in interval_results if item) / len(interval_results)
            if interval_results
            else None
        ),
        minimum_horizon_days=min(item.horizon_days for item in cases),
        maximum_horizon_days=max(item.horizon_days for item in cases),
        backtest_case_ids=stable_ids,
        computed_at=computed_at,
        review_status=ReviewStatus.PROVISIONAL,
    )


def evaluate_backtest_policy(
    summary: ForecastBacktestSummary,
    policy: ForecastBacktestPolicy,
) -> BacktestPolicyEvaluation:
    reasons: list[str] = []
    if policy.review_status != ReviewStatus.VERIFIED:
        reasons.append("policy_not_verified")
    if summary.model_version != policy.model_version:
        reasons.append("model_version_mismatch")
    if summary.metric_semantics_id != policy.metric_semantics_id:
        reasons.append("metric_semantics_mismatch")
    if summary.case_count < policy.minimum_cases:
        reasons.append("insufficient_backtest_cases")
    if summary.maximum_horizon_days > policy.maximum_horizon_days:
        reasons.append("backtest_horizon_exceeds_policy")
    if (
        policy.maximum_mean_absolute_error is not None
        and summary.mean_absolute_error > policy.maximum_mean_absolute_error
    ):
        reasons.append("mean_absolute_error_exceeds_policy")
    if (
        policy.maximum_root_mean_squared_error is not None
        and summary.root_mean_squared_error > policy.maximum_root_mean_squared_error
    ):
        reasons.append("rmse_exceeds_policy")
    if (
        policy.maximum_absolute_mean_signed_error is not None
        and abs(summary.mean_signed_error) > policy.maximum_absolute_mean_signed_error
    ):
        reasons.append("bias_exceeds_policy")
    if policy.intervals_required and summary.interval_case_count != summary.case_count:
        reasons.append("intervals_missing_from_backtests")
    if policy.minimum_interval_coverage is not None:
        if summary.interval_coverage is None:
            reasons.append("interval_coverage_unavailable")
        elif summary.interval_coverage < policy.minimum_interval_coverage:
            reasons.append("interval_coverage_below_policy")

    return BacktestPolicyEvaluation(
        status="blocked" if reasons else "passes",
        model_version=summary.model_version,
        metric_semantics_id=summary.metric_semantics_id,
        summary_id=summary.id,
        policy_id=policy.id,
        reason_codes=sorted(set(reasons)),
    )


def authorize_forecast_model_execution(
    registration: ForecastModelRegistration,
    policy_evaluation: BacktestPolicyEvaluation,
    approval: ForecastModelApproval,
    *,
    metric_semantics_id: str,
    source_id: str,
    as_of: date,
    horizon_days: int,
) -> ForecastModelExecutionDecision:
    """Require registration, passing backtests and a separate human approval record."""

    reasons: list[str] = []
    if registration.model_version != approval.model_version:
        reasons.append("approval_model_version_mismatch")
    if registration.model_version != policy_evaluation.model_version:
        reasons.append("backtest_model_version_mismatch")
    if metric_semantics_id not in registration.supported_metric_semantics_ids:
        reasons.append("metric_not_registered_for_model")
    if source_id not in registration.allowed_source_ids:
        reasons.append("source_not_registered_for_model")
    if horizon_days <= 0:
        reasons.append("forecast_horizon_not_positive")
    if horizon_days > registration.maximum_horizon_days:
        reasons.append("forecast_horizon_exceeds_registration")
    if policy_evaluation.metric_semantics_id != metric_semantics_id:
        reasons.append("backtest_metric_mismatch")
    if policy_evaluation.status != "passes":
        reasons.append("backtest_policy_not_passed")
    if approval.metric_semantics_id != metric_semantics_id:
        reasons.append("approval_metric_mismatch")
    if approval.policy_id != policy_evaluation.policy_id:
        reasons.append("approval_policy_mismatch")
    if approval.backtest_summary_id != policy_evaluation.summary_id:
        reasons.append("approval_backtest_summary_mismatch")
    if approval.decision != "approved":
        reasons.append("model_not_human_approved")
    if approval.review_status != ReviewStatus.VERIFIED:
        reasons.append("model_approval_not_verified")
    if as_of < approval.valid_from:
        reasons.append("model_approval_not_yet_valid")
    if approval.valid_until is not None and as_of > approval.valid_until:
        reasons.append("model_approval_expired")

    return ForecastModelExecutionDecision(
        status="blocked" if reasons else "ready",
        reason_codes=sorted(set(reasons)),
        model_version=registration.model_version,
        metric_semantics_id=metric_semantics_id,
        backtest_summary_id=policy_evaluation.summary_id,
        approval_id=approval.id,
    )

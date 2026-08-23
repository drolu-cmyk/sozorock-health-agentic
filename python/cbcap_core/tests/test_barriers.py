from datetime import date, datetime, timezone

from cbcap_core.barriers import (
    classify_barrier_measure,
    classify_barrier_measures,
    summarize_barriers,
)
from cbcap_core.models import (
    BarrierFamily,
    BarrierObservation,
    GeographyKind,
    GeographyRef,
    Measure,
    MetricSemantics,
    ReviewStatus,
    SourceVersionRef,
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


def source() -> SourceVersionRef:
    return SourceVersionRef(
        source_id="cdc-places",
        source_version_id="cdc-places:2025",
        publisher="Centers for Disease Control and Prevention",
        title="PLACES",
        official_url="https://www.cdc.gov/places/",
        release_label="2025",
        release_date=date(2025, 12, 1),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="places.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def measure(
    source_measure_id: str,
    *,
    metric_id: str | None = None,
    direction: str = "adverse",
    comparison_policy: str = "higher_is_concern",
    review_status: ReviewStatus = ReviewStatus.VERIFIED,
    numeric_value: float | None = 12.5,
) -> Measure:
    metric_id = metric_id or source_measure_id.lower()
    semantics = MetricSemantics(
        id=metric_id,
        source_measure_id=source_measure_id,
        name=metric_id,
        description="Controlled barrier ontology test measure.",
        direction=direction,
        higher_value_meaning="adverse" if direction == "adverse" else "neutral",
        unit="percent",
        universe="adults",
        adjustment="modeled",
        comparison_policy=comparison_policy,
        allowed_geography_kinds=[GeographyKind.COUNTY],
        review_status=ReviewStatus.VERIFIED,
    )
    return Measure(
        id=f"measure:{metric_id}:36001",
        semantics=semantics,
        geography=county(),
        source_version=source(),
        value=numeric_value,
        numeric_value=numeric_value,
        review_status=review_status,
    )


def test_transportation_measure_is_admitted_to_transportation_family():
    decision = classify_barrier_measure(measure("LACKTRPT", metric_id="transportation"))
    assert decision.status == "admitted"
    assert decision.observation is not None
    assert decision.observation.barrier_family == BarrierFamily.TRANSPORTATION_TRAVEL
    assert decision.observation.pressure_percentile is None
    assert decision.observation.trend_direction == "insufficient_evidence"


def test_disability_is_context_only_and_never_becomes_barrier_observation():
    decision = classify_barrier_measure(
        measure(
            "DISABILITY",
            metric_id="disability",
            direction="contextual",
            comparison_policy="context_only",
        )
    )
    assert decision.status == "context_only"
    assert decision.observation is None
    assert decision.reason_codes == ["context_not_barrier"]


def test_wrong_metric_direction_fails_closed():
    decision = classify_barrier_measure(
        measure(
            "LACKTRPT",
            metric_id="transportation",
            direction="protective",
            comparison_policy="lower_is_concern",
        )
    )
    assert decision.status == "rejected"
    assert "metric_direction_mismatch" in decision.reason_codes
    assert "comparison_policy_mismatch" in decision.reason_codes


def test_unverified_measure_cannot_become_barrier_observation():
    decision = classify_barrier_measure(
        measure("UNINSURED", metric_id="uninsured", review_status=ReviewStatus.PROVISIONAL)
    )
    assert decision.status == "rejected"
    assert "measure_not_verified" in decision.reason_codes


def test_unknown_measure_is_not_auto_classified_as_barrier():
    decision = classify_barrier_measure(measure("SOME_NEW_MEASURE", metric_id="new_measure"))
    assert decision.status == "rejected"
    assert decision.reason_codes == ["measure_not_in_barrier_ontology"]


def test_batch_classification_keeps_context_separate_from_barriers():
    result = classify_barrier_measures(
        [
            measure("LACKTRPT", metric_id="transportation"),
            measure(
                "DISABILITY",
                metric_id="disability",
                direction="contextual",
                comparison_policy="context_only",
            ),
        ]
    )
    assert len(result.decisions) == 2
    assert len(result.observations) == 1
    assert result.observations[0].barrier_family == BarrierFamily.TRANSPORTATION_TRAVEL


def test_cooccurrence_requires_explicit_pressure_and_does_not_claim_causation():
    observations = [
        BarrierObservation(
            id="barrier:transportation",
            barrier_family=BarrierFamily.TRANSPORTATION_TRAVEL,
            geography=county(),
            measure_id="measure:transportation",
            observed_value=12.5,
            pressure_percentile=82.0,
            evidence_quality="high",
            review_status=ReviewStatus.VERIFIED,
        ),
        BarrierObservation(
            id="barrier:housing",
            barrier_family=BarrierFamily.HOUSING,
            geography=county(),
            measure_id="measure:housing",
            observed_value=18.0,
            pressure_percentile=79.0,
            evidence_quality="high",
            review_status=ReviewStatus.VERIFIED,
        ),
    ]
    summary = summarize_barriers(observations, county().id, attention_threshold=75.0)
    assert len(summary.attention_observations) == 2
    assert len(summary.cooccurrences) == 1
    assert "not causation" in summary.cooccurrences[0].basis.lower()

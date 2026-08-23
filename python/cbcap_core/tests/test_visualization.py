from cbcap_core.models import GeographyKind, MetricSemantics, ReviewStatus
from cbcap_core.visualization import VisualizationRequest, select_visualization


def metric(*, trendable=False, visuals=None):
    return MetricSemantics(
        id="metric:test",
        source_measure_id="TEST",
        name="Test metric",
        description="Controlled visualization test metric.",
        direction="adverse",
        higher_value_meaning="adverse",
        unit="percent",
        universe="test",
        adjustment="modeled",
        comparison_policy="higher_is_concern",
        trendable=trendable,
        allowed_geography_kinds=[GeographyKind.COUNTY],
        allowed_visualizations=visuals or [],
        review_status=ReviewStatus.VERIFIED,
    )


def test_choropleth_requires_explicit_semantic_permission():
    blocked = select_visualization(
        VisualizationRequest(intent="locate", metrics=[metric()], geography_count=10)
    )
    assert blocked.status == "blocked"

    ready = select_visualization(
        VisualizationRequest(
            intent="locate",
            metrics=[metric(visuals=["choropleth"])],
            geography_count=10,
        )
    )
    assert ready.status == "ready"
    assert ready.kind == "choropleth"


def test_nontrendable_measure_cannot_generate_trend_line():
    decision = select_visualization(
        VisualizationRequest(
            intent="trend",
            metrics=[metric(trendable=False, visuals=["trend_line"])],
            time_points=4,
        )
    )
    assert decision.status == "blocked"
    assert "non-trendable" in decision.reason


def test_bivariate_map_requires_both_metrics_to_allow_it():
    first = metric(visuals=["bivariate_map"])
    second = metric(visuals=["choropleth"])
    second = second.model_copy(update={"id": "metric:second", "source_measure_id": "SECOND"})
    decision = select_visualization(
        VisualizationRequest(
            intent="overlap",
            metrics=[first, second],
            geography_count=20,
        )
    )
    assert decision.status == "blocked"


def test_heatmap_is_blocked_for_nonaggregate_points():
    decision = select_visualization(
        VisualizationRequest(
            intent="point_density",
            metrics=[metric(visuals=["density_heatmap"])],
            point_count=100,
            points_are_aggregate_non_sensitive=False,
        )
    )
    assert decision.status == "blocked"

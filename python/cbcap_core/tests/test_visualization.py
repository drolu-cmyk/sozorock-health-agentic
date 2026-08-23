from cbcap_core.models import GeographyKind, MetricSemantics, ReviewStatus
from cbcap_core.visualization import VisualizationRequest, select_visualization


def metric(
    *,
    metric_id="metric:test",
    source_measure_id="TEST",
    trendable=False,
    visuals=None,
):
    return MetricSemantics(
        id=metric_id,
        source_measure_id=source_measure_id,
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


def test_area_location_question_uses_choropleth_only_when_explicitly_allowed():
    blocked = select_visualization(
        VisualizationRequest(intent="locate", metrics=[metric()], geography_count=10)
    )
    assert blocked.status == "blocked"

    ready = select_visualization(
        VisualizationRequest(
            intent="locate",
            metrics=[metric(visuals=["choropleth", "ranked_dot"])],
            geography_count=10,
        )
    )
    assert ready.status == "ready"
    assert ready.kind == "choropleth"
    assert ready.kind != "density_heatmap"


def test_compare_question_prefers_ranked_dot_when_question_is_not_spatial():
    decision = select_visualization(
        VisualizationRequest(
            intent="compare",
            metrics=[metric(visuals=["choropleth", "ranked_dot"])],
            geography_count=20,
        )
    )
    assert decision.status == "ready"
    assert decision.kind == "ranked_dot"


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


def test_trendable_measure_with_uncertainty_requires_uncertainty_caveat():
    decision = select_visualization(
        VisualizationRequest(
            intent="trend",
            metrics=[metric(trendable=True, visuals=["trend_line"])],
            time_points=4,
            has_uncertainty=True,
        )
    )
    assert decision.status == "ready"
    assert decision.kind == "trend_line"
    assert any("uncertainty" in item.lower() for item in decision.caveats)


def test_bivariate_map_requires_both_metrics_to_allow_it():
    first = metric(metric_id="metric:first", source_measure_id="FIRST", visuals=["bivariate_map"])
    second = metric(metric_id="metric:second", source_measure_id="SECOND", visuals=["choropleth"])
    decision = select_visualization(
        VisualizationRequest(
            intent="overlap",
            metrics=[first, second],
            geography_count=20,
        )
    )
    assert decision.status == "blocked"


def test_bivariate_map_labels_overlap_as_noncausal():
    first = metric(metric_id="metric:first", source_measure_id="FIRST", visuals=["bivariate_map"])
    second = metric(metric_id="metric:second", source_measure_id="SECOND", visuals=["bivariate_map"])
    decision = select_visualization(
        VisualizationRequest(
            intent="overlap",
            metrics=[first, second],
            geography_count=20,
        )
    )
    assert decision.status == "ready"
    assert decision.kind == "bivariate_map"
    assert any("causal" in item.lower() for item in decision.caveats)


def test_scatterplot_requires_both_metrics_and_warns_against_causation():
    first = metric(metric_id="metric:first", source_measure_id="FIRST", visuals=["scatterplot"])
    second = metric(metric_id="metric:second", source_measure_id="SECOND", visuals=["scatterplot"])
    decision = select_visualization(
        VisualizationRequest(
            intent="relationship",
            metrics=[first, second],
            geography_count=20,
        )
    )
    assert decision.status == "ready"
    assert decision.kind == "scatterplot"
    assert any("causation" in item.lower() for item in decision.caveats)


def test_heatmap_is_blocked_for_nonaggregate_or_sensitive_points():
    decision = select_visualization(
        VisualizationRequest(
            intent="point_density",
            metrics=[metric(visuals=["density_heatmap"])],
            point_count=100,
            points_are_aggregate_non_sensitive=False,
        )
    )
    assert decision.status == "blocked"


def test_heatmap_is_allowed_only_for_approved_aggregate_point_density():
    decision = select_visualization(
        VisualizationRequest(
            intent="point_density",
            metrics=[metric(visuals=["density_heatmap"])],
            point_count=100,
            points_are_aggregate_non_sensitive=True,
        )
    )
    assert decision.status == "ready"
    assert decision.kind == "density_heatmap"
    assert any("choropleth" in item.lower() for item in decision.caveats)


def test_every_ready_view_requires_accessible_alternative():
    decision = select_visualization(
        VisualizationRequest(
            intent="compare",
            metrics=[metric(visuals=["ranked_dot"])],
            geography_count=20,
        )
    )
    assert decision.status == "ready"
    assert decision.accessible_alternative_required is True

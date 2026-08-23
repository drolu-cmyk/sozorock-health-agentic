from __future__ import annotations

from typing import Literal

from pydantic import Field

from .models import MetricSemantics, StrictModel

VisualizationIntent = Literal[
    "locate",
    "compare",
    "trend",
    "relationship",
    "overlap",
    "distribution",
    "uncertainty",
    "point_density",
]
VisualizationKind = Literal[
    "choropleth",
    "ranked_dot",
    "trend_line",
    "scatterplot",
    "bivariate_map",
    "distribution",
    "uncertainty_interval",
    "density_heatmap",
]


class VisualizationRequest(StrictModel):
    intent: VisualizationIntent
    metrics: list[MetricSemantics] = Field(min_length=1, max_length=2)
    geography_count: int = Field(default=1, ge=1)
    time_points: int = Field(default=1, ge=1)
    has_uncertainty: bool = False
    point_count: int = Field(default=0, ge=0)
    points_are_aggregate_non_sensitive: bool = False


class VisualizationDecision(StrictModel):
    status: Literal["ready", "blocked"]
    kind: VisualizationKind | None = None
    reason: str = Field(min_length=1)
    caveats: list[str] = Field(default_factory=list)
    accessible_alternative_required: bool = True


def _allowed(metrics: list[MetricSemantics], kind: VisualizationKind) -> bool:
    return all(kind in metric.allowed_visualizations for metric in metrics)


def _blocked(reason: str, *caveats: str) -> VisualizationDecision:
    return VisualizationDecision(
        status="blocked",
        reason=reason,
        caveats=list(caveats),
    )


def select_visualization(request: VisualizationRequest) -> VisualizationDecision:
    """Select a defensible default view from explicit metric semantics.

    The selector fails closed. A chart type that has not been approved in the
    metric semantics cannot be generated autonomously.
    """

    metrics = request.metrics

    if request.intent == "locate":
        if len(metrics) != 1 or request.geography_count < 2:
            return _blocked("A location map requires one measure across multiple geographies.")
        kind: VisualizationKind = "choropleth"
        if not _allowed(metrics, kind):
            return _blocked("Choropleth is not approved for this metric's semantics.")
        return VisualizationDecision(
            status="ready",
            kind=kind,
            reason="One approved area measure is being compared across multiple geographies.",
            caveats=["Missing and suppressed areas must remain visually distinct from low values."],
        )

    if request.intent == "compare":
        if len(metrics) != 1 or request.geography_count < 2:
            return _blocked("A ranked comparison requires one measure across multiple geographies.")
        kind = "ranked_dot"
        if not _allowed(metrics, kind):
            return _blocked("Ranked comparison is not approved for this metric's semantics.")
        return VisualizationDecision(status="ready", kind=kind, reason="The question is comparative rather than spatial.")

    if request.intent == "trend":
        if len(metrics) != 1 or request.time_points < 2:
            return _blocked("A trend requires one metric with at least two comparable time points.")
        metric = metrics[0]
        if not metric.trendable:
            return _blocked("This metric is explicitly marked non-trendable.")
        kind = "trend_line"
        if not _allowed(metrics, kind):
            return _blocked("Trend-line rendering is not approved for this metric's semantics.")
        caveats = ["Data vintages and definitions must remain comparable across displayed periods."]
        if request.has_uncertainty:
            caveats.append("Show uncertainty bands or intervals rather than a line alone.")
        return VisualizationDecision(status="ready", kind=kind, reason="The metric is approved for longitudinal comparison.", caveats=caveats)

    if request.intent == "relationship":
        if len(metrics) != 2 or request.geography_count < 3:
            return _blocked("A relationship view requires two metrics observed across multiple comparable geographies.")
        kind = "scatterplot"
        if not _allowed(metrics, kind):
            return _blocked("Scatterplot is not approved for both metric semantics.")
        return VisualizationDecision(
            status="ready",
            kind=kind,
            reason="Two approved measures are being examined across comparable geographies.",
            caveats=["Visual association must not be described as causation."],
        )

    if request.intent == "overlap":
        if len(metrics) != 2 or request.geography_count < 2:
            return _blocked("A bivariate overlap map requires two metrics across multiple geographies.")
        kind = "bivariate_map"
        if not _allowed(metrics, kind):
            return _blocked("Bivariate mapping is not approved for both metric semantics.")
        return VisualizationDecision(
            status="ready",
            kind=kind,
            reason="The question asks where two area-level measures are simultaneously elevated.",
            caveats=["The map shows geographic co-occurrence, not a causal relationship."],
        )

    if request.intent == "distribution":
        if len(metrics) != 1 or request.geography_count < 3:
            return _blocked("A distribution requires one measure across multiple observations.")
        kind = "distribution"
        if not _allowed(metrics, kind):
            return _blocked("Distribution rendering is not approved for this metric's semantics.")
        return VisualizationDecision(status="ready", kind=kind, reason="The question concerns position within a distribution.")

    if request.intent == "uncertainty":
        if len(metrics) != 1 or not request.has_uncertainty:
            return _blocked("An uncertainty view requires a metric with interval or error information.")
        kind = "uncertainty_interval"
        if not _allowed(metrics, kind):
            return _blocked("Uncertainty-interval rendering is not approved for this metric's semantics.")
        return VisualizationDecision(status="ready", kind=kind, reason="The decision requires uncertainty to be visible explicitly.")

    if request.intent == "point_density":
        if request.point_count < 2:
            return _blocked("A density heat map requires multiple point observations.")
        if not request.points_are_aggregate_non_sensitive:
            return _blocked("Density heat maps are blocked for points that are not explicitly aggregate and non-sensitive.")
        kind = "density_heatmap"
        if not _allowed(metrics, kind):
            return _blocked("Density heat mapping is not approved for this metric's semantics.")
        return VisualizationDecision(
            status="ready",
            kind=kind,
            reason="The input is an approved aggregate point-density dataset rather than an area rate.",
            caveats=["Do not use a density heat map as a substitute for an area-level choropleth."],
        )

    return _blocked("No visualization rule matched the request.")

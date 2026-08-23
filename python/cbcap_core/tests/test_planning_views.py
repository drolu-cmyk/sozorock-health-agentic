from cbcap_core.planning_views import PlanningViewRequest, select_planning_view


def test_barrier_matrix_requires_multiple_barriers_and_marks_noncausal():
    blocked = select_planning_view(
        PlanningViewRequest(question="which_barriers_overlap", barrier_count=1)
    )
    assert blocked.status == "blocked"

    ready = select_planning_view(
        PlanningViewRequest(question="which_barriers_overlap", barrier_count=3)
    )
    assert ready.status == "ready"
    assert ready.kind == "barrier_matrix"
    assert any("causation" in item.lower() for item in ready.caveats)


def test_plan_alignment_requires_verified_lineage():
    blocked = select_planning_view(
        PlanningViewRequest(
            question="how_plans_align",
            plan_count=3,
            has_verified_lineage=False,
        )
    )
    assert blocked.status == "blocked"

    ready = select_planning_view(
        PlanningViewRequest(
            question="how_plans_align",
            plan_count=3,
            has_verified_lineage=True,
        )
    )
    assert ready.status == "ready"
    assert ready.kind == "plan_alignment_matrix"


def test_evidence_timeline_requires_explicit_time_semantics():
    blocked = select_planning_view(
        PlanningViewRequest(
            question="what_changed",
            evidence_events=4,
            has_time_semantics=False,
        )
    )
    assert blocked.status == "blocked"

    ready = select_planning_view(
        PlanningViewRequest(
            question="what_changed",
            evidence_events=4,
            has_time_semantics=True,
        )
    )
    assert ready.status == "ready"
    assert ready.kind == "evidence_timeline"


def test_scenario_view_keeps_observed_and_projected_values_distinct():
    ready = select_planning_view(
        PlanningViewRequest(question="compare_scenarios", scenario_count=3)
    )
    assert ready.status == "ready"
    assert ready.kind == "scenario_comparison"
    assert any("observed" in item.lower() and "projection" in item.lower() for item in ready.caveats)


def test_funding_pipeline_requires_verified_lineage_and_never_implies_award_probability():
    blocked = select_planning_view(
        PlanningViewRequest(
            question="which_funding_moves_next",
            funding_opportunity_count=5,
            has_verified_lineage=False,
        )
    )
    assert blocked.status == "blocked"

    ready = select_planning_view(
        PlanningViewRequest(
            question="which_funding_moves_next",
            funding_opportunity_count=5,
            has_verified_lineage=True,
        )
    )
    assert ready.status == "ready"
    assert ready.kind == "funding_pipeline"
    assert any("award probability" in item.lower() for item in ready.caveats)


def test_relationship_graph_requires_verified_edges():
    blocked = select_planning_view(
        PlanningViewRequest(
            question="how_entities_are_connected",
            relationship_node_count=5,
            relationship_edge_count=0,
            has_verified_lineage=True,
        )
    )
    assert blocked.status == "blocked"

    ready = select_planning_view(
        PlanningViewRequest(
            question="how_entities_are_connected",
            relationship_node_count=5,
            relationship_edge_count=4,
            has_verified_lineage=True,
        )
    )
    assert ready.status == "ready"
    assert ready.kind == "relationship_graph"


def test_dense_mobile_views_use_a_simpler_sibling_instead_of_shrinking_desktop():
    decision = select_planning_view(
        PlanningViewRequest(
            question="how_plans_align",
            plan_count=4,
            has_verified_lineage=True,
            mobile=True,
        )
    )
    assert decision.status == "ready"
    assert decision.kind == "plan_alignment_matrix"
    assert decision.mobile_sibling == "stacked_list"

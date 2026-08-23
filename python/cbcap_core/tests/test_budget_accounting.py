from datetime import datetime, timezone

from cbcap_core.graph import BranchResult, RunBudget, validate_join
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus

NOW = datetime(2026, 8, 22, 23, 45, tzinfo=timezone.utc)


def run() -> CountyRunState:
    return CountyRunState(
        run_id="run:budget:36001",
        county=GeographyRef(
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
        ),
        requested_at=NOW,
    )


def branch_results():
    return [
        BranchResult(
            id="run:budget:36001:branch:public_evidence",
            branch="public_evidence",
            complete=True,
            evidence_ids=["measure:1"],
        ),
        BranchResult(
            id="run:budget:36001:branch:planning_documents",
            branch="planning_documents",
            complete=True,
            evidence_ids=["plan:1"],
            external_calls_used=2,
        ),
        BranchResult(
            id="run:budget:36001:branch:workforce_designations",
            branch="workforce_designations",
            complete=True,
            evidence_ids=["workforce:1"],
        ),
        BranchResult(
            id="run:budget:36001:branch:barrier_evidence",
            branch="barrier_evidence",
            complete=True,
            evidence_ids=["barrier:1"],
        ),
    ]


def state(budget: RunBudget):
    return {
        "county_run": run().model_dump(mode="json"),
        "budget": budget.model_dump(mode="json"),
        "branch_results": [item.model_dump(mode="json") for item in branch_results()],
        "branch_payloads": [],
        "audit_events": [],
        "trajectory_events": [],
    }


def test_join_adds_branch_calls_to_preflight_calls():
    result = validate_join(
        state(
            RunBudget(
                max_external_calls=5,
                preflight_external_calls_used=1,
                external_calls_used=1,
            )
        )
    )
    budget = RunBudget.model_validate(result["budget"])
    assert budget.preflight_external_calls_used == 1
    assert budget.external_calls_used == 3


def test_join_replay_recomputes_without_double_counting_preflight_calls():
    first = validate_join(
        state(
            RunBudget(
                max_external_calls=5,
                preflight_external_calls_used=1,
                external_calls_used=1,
            )
        )
    )
    replay_state = state(RunBudget.model_validate(first["budget"]))
    second = validate_join(replay_state)
    budget = RunBudget.model_validate(second["budget"])
    assert budget.external_calls_used == 3


def test_preflight_calls_alone_can_trip_policy_budget():
    budget = RunBudget(
        max_external_calls=0,
        preflight_external_calls_used=1,
        external_calls_used=0,
    )
    assert budget.exceeded()

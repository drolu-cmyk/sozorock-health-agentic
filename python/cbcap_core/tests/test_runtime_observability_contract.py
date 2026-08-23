import inspect

from cbcap_core.observability import build_run_telemetry


def test_runtime_observability_helper_has_required_named_contract():
    parameters = inspect.signature(build_run_telemetry).parameters
    required = {
        "started_at",
        "completed_at",
        "run",
        "budget",
        "trajectory_events",
        "source_release_id",
        "source_release_hash",
        "failure_reason",
    }
    missing = sorted(required - set(parameters))
    assert missing == []

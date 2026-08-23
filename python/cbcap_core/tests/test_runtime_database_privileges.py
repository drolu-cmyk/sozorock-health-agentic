from inspect import getsource

from cbcap_core.migration_runner import (
    RUNTIME_INSERT_TABLES,
    RUNTIME_SELECT_TABLES,
    _ensure_runtime_role,
)


EXPECTED_RUNTIME_SELECT_TABLES = {
    "workspace_membership_event",
    "county_run_identity",
    "county_run_state_version",
}
EXPECTED_RUNTIME_INSERT_TABLES = {
    "county_run_identity",
    "county_run_state_version",
    "trajectory_event",
    "run_observation",
}


def test_shared_runtime_read_allowlist_is_exact_and_minimal():
    assert set(RUNTIME_SELECT_TABLES) == EXPECTED_RUNTIME_SELECT_TABLES


def test_shared_runtime_write_allowlist_is_exact_and_minimal():
    assert set(RUNTIME_INSERT_TABLES) == EXPECTED_RUNTIME_INSERT_TABLES


def test_server_authority_ledgers_are_not_runtime_writable():
    forbidden = {
        "workspace_membership_event",
        "tenant_evidence_document",
        "tenant_evidence_review",
        "publication_authorization",
        "decision_memory",
        "forecast_model_registration",
        "forecast_backtest_case",
        "forecast_backtest_summary",
        "forecast_backtest_policy",
        "forecast_backtest_policy_evaluation",
        "forecast_model_approval",
        "trajectory_evaluation_label",
        "trajectory_correction",
    }
    assert forbidden.isdisjoint(RUNTIME_INSERT_TABLES)


def test_private_and_governance_tables_are_not_shared_runtime_readable():
    forbidden = {
        "tenant_evidence_document",
        "tenant_evidence_review",
        "publication_authorization",
        "decision_memory",
        "forecast_model_registration",
        "forecast_backtest_case",
        "forecast_backtest_summary",
        "forecast_backtest_policy",
        "forecast_backtest_policy_evaluation",
        "forecast_model_approval",
    }
    assert forbidden.isdisjoint(RUNTIME_SELECT_TABLES)


def test_runtime_role_resets_grants_and_defaults_future_tables_to_no_access():
    source = getsource(_ensure_runtime_role)
    assert "REVOKE ALL ON ALL TABLES IN SCHEMA cbcap" in source
    assert "ALTER DEFAULT PRIVILEGES IN SCHEMA cbcap REVOKE ALL ON TABLES" in source
    assert "GRANT SELECT ON ALL TABLES IN SCHEMA cbcap" not in source
    assert "GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA cbcap" not in source
    assert "ALTER DEFAULT PRIVILEGES IN SCHEMA cbcap GRANT SELECT ON TABLES" not in source

from inspect import getsource

from cbcap_core.migration_runner import (
    RUNTIME_INSERT_TABLES,
    RUNTIME_SELECT_TABLES,
    RUNTIME_UPDATE_COLUMNS,
    _ensure_runtime_role,
    _grant_runtime_lock_columns,
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
EXPECTED_RUNTIME_UPDATE_COLUMNS = {
    "county_run_identity": ("run_id",),
}


def test_shared_runtime_read_allowlist_is_exact_and_minimal():
    assert set(RUNTIME_SELECT_TABLES) == EXPECTED_RUNTIME_SELECT_TABLES


def test_shared_runtime_write_allowlist_is_exact_and_minimal():
    assert set(RUNTIME_INSERT_TABLES) == EXPECTED_RUNTIME_INSERT_TABLES


def test_row_lock_update_privilege_is_one_immutable_identity_column_only():
    assert RUNTIME_UPDATE_COLUMNS == EXPECTED_RUNTIME_UPDATE_COLUMNS
    source = getsource(_grant_runtime_lock_columns)
    assert "GRANT UPDATE ({}) ON TABLE cbcap.{} TO {}" in source
    assert "GRANT UPDATE ON TABLE" not in source


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
    assert forbidden.isdisjoint(RUNTIME_UPDATE_COLUMNS)


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

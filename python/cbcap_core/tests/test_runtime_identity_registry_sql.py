from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SQL_ROOT = REPO_ROOT / "sql"


def read_sql(relative: str) -> str:
    return (SQL_ROOT / relative).read_text(encoding="utf-8")


def test_membership_history_is_server_side_tenant_scoped_and_append_only():
    sql = read_sql("008_runtime_identity_registry.sql")
    assert "cbcap.workspace_membership_event" in sql
    assert "principal_key ~ '^principal:sha256:[0-9a-f]{64}$'" in sql
    assert "decision IN ('granted', 'revoked')" in sql
    assert "role IN ('read_only', 'analyst', 'planner', 'reviewer', 'admin')" in sql
    assert "workspace_membership_tenant_isolation" in sql
    assert "workspace_membership_append_only" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "UNIQUE (tenant_id, principal_key, recorded_at)" in sql


def test_county_run_identity_and_state_are_server_owned_append_only_history():
    sql = read_sql("008_runtime_identity_registry.sql")
    assert "cbcap.county_run_identity" in sql
    assert "cbcap.county_run_state_version" in sql
    assert "county_fips ~ '^[0-9]{5}$'" in sql
    assert "state_hash ~ '^sha256:[0-9a-f]{64}$'" in sql
    assert "UNIQUE (tenant_id, run_id, version_no)" in sql
    assert "county_run_state_guard" in sql
    assert "first county run state version must be 1" in sql
    assert "county run state versions must be contiguous" in sql
    assert "county_run_identity_append_only" in sql
    assert "county_run_state_append_only" in sql


def test_runtime_registry_rollback_refuses_to_erase_identity_or_run_history():
    rollback = read_sql("rollback/008_runtime_identity_registry.down.sql")
    assert "Refusing to drop CB-CAP workspace membership history" in rollback
    assert "Refusing to drop CB-CAP county run state history" in rollback
    assert "Refusing to drop CB-CAP county run identities" in rollback

from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[3]
SQL_ROOT = REPO_ROOT / "sql"


def read_sql(relative: str) -> str:
    return (SQL_ROOT / relative).read_text(encoding="utf-8")


def test_operational_telemetry_has_independent_append_only_guard():
    sql = read_sql("006_operational_observability_immutability.sql")
    assert "prevent_observability_mutation" in sql
    assert "run_telemetry_append_only" in sql
    assert "node_telemetry_sample_append_only" in sql
    assert "BEFORE UPDATE OR DELETE ON cbcap.run_telemetry" in sql
    assert "BEFORE UPDATE OR DELETE ON cbcap.node_telemetry_sample" in sql
    assert "prevent_immutable_record_mutation" not in sql


def test_observability_immutability_rollback_refuses_when_history_exists():
    rollback = read_sql("rollback/006_operational_observability_immutability.down.sql")
    assert "Refusing to remove CB-CAP observability immutability" in rollback
    assert "SELECT 1 FROM cbcap.run_telemetry" in rollback
    assert "SELECT 1 FROM cbcap.node_telemetry_sample" in rollback
    assert "DROP FUNCTION IF EXISTS cbcap.prevent_observability_mutation" in rollback

from pathlib import Path
from typing import get_args

from cbcap_core.decision_memory import MemoryDecisionType
from cbcap_core.trajectory import TrajectoryStage

REPO_ROOT = Path(__file__).resolve().parents[3]
SQL_ROOT = REPO_ROOT / "sql"


def read_sql(relative: str) -> str:
    return (SQL_ROOT / relative).read_text(encoding="utf-8")


def test_decision_memory_sql_matches_canonical_decision_types_and_is_append_only():
    sql = read_sql("001_decision_memory.sql")
    for decision_type in get_args(MemoryDecisionType):
        assert f"'{decision_type}'" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "decision_memory_tenant_isolation" in sql
    assert "decision_memory_append_only" in sql
    assert "prevent_immutable_record_mutation" in sql


def test_trajectory_sql_matches_canonical_stages_and_enforces_parent_tenant_scope():
    sql = read_sql("002_trajectory_evaluation.sql")
    for stage in get_args(TrajectoryStage):
        assert f"'{stage}'" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "enforce_trajectory_child_tenant" in sql
    assert "IS DISTINCT FROM NEW.tenant_id" in sql
    assert "trajectory_event_append_only" in sql
    assert "trajectory_label_append_only" in sql
    assert "trajectory_correction_append_only" in sql
    assert "model_provider IS NOT NULL AND model_name IS NOT NULL" in sql


def test_trajectory_rollback_refuses_to_drop_nonempty_history():
    rollback = read_sql("rollback/002_trajectory_evaluation.down.sql")
    assert "Refusing to drop CB-CAP trajectory history" in rollback
    assert "DROP FUNCTION IF EXISTS cbcap.enforce_trajectory_child_tenant" in rollback


def test_memory_rollback_requires_trajectory_rollback_first_and_preserves_records():
    rollback = read_sql("rollback/001_decision_memory.down.sql")
    assert "Roll back 002 first" in rollback
    assert "institutional memory records exist" in rollback
    assert "DROP FUNCTION IF EXISTS cbcap.prevent_immutable_record_mutation" in rollback

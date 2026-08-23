from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
MIGRATION = REPO_ROOT / "sql" / "009_checkpoint_tenant_isolation.sql"
ROLLBACK = REPO_ROOT / "sql" / "rollback" / "009_checkpoint_tenant_isolation.down.sql"


def test_checkpoint_rls_migration_is_forced_and_fail_closed_for_all_tenant_tables():
    sql = MIGRATION.read_text(encoding="utf-8")

    assert sql.strip().startswith("BEGIN;")
    assert sql.strip().endswith("COMMIT;")
    for table_name, policy_name in (
        ("public.checkpoints", "cbcap_checkpoint_tenant_isolation"),
        ("public.checkpoint_blobs", "cbcap_checkpoint_blob_tenant_isolation"),
        ("public.checkpoint_writes", "cbcap_checkpoint_write_tenant_isolation"),
    ):
        assert f"ALTER TABLE {table_name} ENABLE ROW LEVEL SECURITY" in sql
        assert f"ALTER TABLE {table_name} FORCE ROW LEVEL SECURITY" in sql
        assert f"CREATE POLICY {policy_name}" in sql

    assert "nullif(current_setting('app.tenant_id', true), '') IS NOT NULL" in sql
    assert "':county-run:'" in sql
    assert "left(" in sql
    assert " LIKE " not in sql.upper()


def test_checkpoint_rls_rollback_refuses_to_weaken_nonempty_checkpoint_history():
    sql = ROLLBACK.read_text(encoding="utf-8")

    assert "IF EXISTS (SELECT 1 FROM public.checkpoints LIMIT 1)" in sql
    assert "OR EXISTS (SELECT 1 FROM public.checkpoint_blobs LIMIT 1)" in sql
    assert "OR EXISTS (SELECT 1 FROM public.checkpoint_writes LIMIT 1)" in sql
    assert "refusing to disable checkpoint tenant isolation" in sql
    assert "DISABLE ROW LEVEL SECURITY" in sql
    assert sql.index("refusing to disable checkpoint tenant isolation") < sql.index("DISABLE ROW LEVEL SECURITY")

from pathlib import Path


REPO_ROOT = Path(__file__).resolve().parents[3]
PYPROJECT = REPO_ROOT / "python" / "cbcap_core" / "pyproject.toml"


def test_checkpoint_postgres_version_is_exactly_pinned_to_reviewed_schema():
    text = PYPROJECT.read_text(encoding="utf-8")
    assert '"langgraph-checkpoint-postgres==3.1.2"' in text
    assert '"langgraph-checkpoint-postgres>=' not in text


def test_checkpoint_schema_upgrade_requires_explicit_migration_update():
    migration = (REPO_ROOT / "sql" / "009_checkpoint_tenant_isolation.sql").read_text(
        encoding="utf-8"
    )
    assert "public.checkpoints" in migration
    assert "public.checkpoint_blobs" in migration
    assert "public.checkpoint_writes" in migration
    assert "FORCE ROW LEVEL SECURITY" in migration

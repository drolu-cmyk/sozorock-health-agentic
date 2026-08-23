from pathlib import Path

import pytest

from cbcap_core.migration_runner import _migration_files, _sha256
from cbcap_core.schema_readiness import (
    CHECKPOINT_DATA_POLICIES,
    CHECKPOINT_TABLES,
    assert_runtime_schema_ready,
)


class Cursor:
    def __init__(self, connection):
        self.connection = connection
        self.rows = []
        self.row = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.connection.executions.append((normalized, params))
        if normalized.startswith("SELECT migration_name, migration_hash"):
            self.rows = list(self.connection.ledger)
            self.row = None
        elif normalized == "SELECT to_regclass(%s)":
            table = params[0]
            self.row = (table,) if table in self.connection.tables else (None,)
            self.rows = []
        elif normalized.startswith("SELECT c.relrowsecurity"):
            policy_name, schema_name, table_name = params
            qualified_name = f"{schema_name}.{table_name}"
            self.row = self.connection.isolation.get(
                qualified_name,
                (False, False, False),
            )
            self.rows = []

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.row


class Connection:
    def __init__(self, *, ledger, tables=CHECKPOINT_TABLES, isolation=None):
        self.ledger = ledger
        self.tables = set(tables)
        self.isolation = isolation or {
            table_name: (True, True, True)
            for table_name in CHECKPOINT_DATA_POLICIES
        }
        self.executions = []

    def cursor(self):
        return Cursor(self)


def migration(path: Path, body: str) -> None:
    path.write_text(f"BEGIN;\n{body}\nCOMMIT;\n", encoding="utf-8")


def expected_ledger(root: Path):
    return [(path.name, _sha256(path)) for path in _migration_files(root)]


def test_runtime_schema_ready_requires_exact_image_migrations_tables_and_forced_rls(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    migration(tmp_path / "002_second.sql", "SELECT 2;")
    connection = Connection(ledger=expected_ledger(tmp_path))

    assert_runtime_schema_ready(connection, migration_root=tmp_path)

    assert connection.executions[0][0].startswith("SELECT migration_name, migration_hash")
    checkpoint_queries = [entry for entry in connection.executions if entry[0] == "SELECT to_regclass(%s)"]
    assert [entry[1][0] for entry in checkpoint_queries] == list(CHECKPOINT_TABLES)
    rls_queries = [entry for entry in connection.executions if entry[0].startswith("SELECT c.relrowsecurity")]
    assert len(rls_queries) == len(CHECKPOINT_DATA_POLICIES)
    assert {entry[1][0] for entry in rls_queries} == set(CHECKPOINT_DATA_POLICIES.values())


def test_runtime_schema_ready_fails_on_stale_or_changed_migration_hash(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    stale = [("001_first.sql", "sha256:" + "0" * 64)]
    with pytest.raises(RuntimeError, match="migration ledger"):
        assert_runtime_schema_ready(Connection(ledger=stale), migration_root=tmp_path)


def test_runtime_schema_ready_fails_on_missing_or_future_migration(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    current = expected_ledger(tmp_path)

    with pytest.raises(RuntimeError, match="migration ledger"):
        assert_runtime_schema_ready(Connection(ledger=[]), migration_root=tmp_path)

    future = [*current, ("002_future.sql", "sha256:" + "f" * 64)]
    with pytest.raises(RuntimeError, match="migration ledger"):
        assert_runtime_schema_ready(Connection(ledger=future), migration_root=tmp_path)


def test_runtime_schema_ready_fails_when_checkpoint_schema_is_incomplete(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    tables = set(CHECKPOINT_TABLES)
    tables.remove("public.checkpoint_writes")

    with pytest.raises(RuntimeError, match="checkpoint schema"):
        assert_runtime_schema_ready(
            Connection(ledger=expected_ledger(tmp_path), tables=tables),
            migration_root=tmp_path,
        )


@pytest.mark.parametrize(
    "isolation_state",
    [
        (False, True, True),
        (True, False, True),
        (True, True, False),
    ],
)
def test_runtime_schema_ready_fails_if_checkpoint_rls_or_expected_policy_is_missing(
    tmp_path,
    isolation_state,
):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    isolation = {
        table_name: (True, True, True)
        for table_name in CHECKPOINT_DATA_POLICIES
    }
    isolation["public.checkpoints"] = isolation_state

    with pytest.raises(RuntimeError, match="tenant isolation"):
        assert_runtime_schema_ready(
            Connection(
                ledger=expected_ledger(tmp_path),
                isolation=isolation,
            ),
            migration_root=tmp_path,
        )

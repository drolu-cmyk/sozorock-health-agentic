from pathlib import Path

import pytest

from cbcap_core.migration_runner import _migration_files, _sha256
from cbcap_core.schema_readiness import CHECKPOINT_TABLES, assert_runtime_schema_ready


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

    def fetchall(self):
        return self.rows

    def fetchone(self):
        return self.row


class Connection:
    def __init__(self, *, ledger, tables=CHECKPOINT_TABLES):
        self.ledger = ledger
        self.tables = set(tables)
        self.executions = []

    def cursor(self):
        return Cursor(self)


def migration(path: Path, body: str) -> None:
    path.write_text(f"BEGIN;\n{body}\nCOMMIT;\n", encoding="utf-8")


def expected_ledger(root: Path):
    return [(path.name, _sha256(path)) for path in _migration_files(root)]


def test_runtime_schema_ready_requires_exact_image_migration_hashes_and_checkpoint_tables(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    migration(tmp_path / "002_second.sql", "SELECT 2;")
    connection = Connection(ledger=expected_ledger(tmp_path))

    assert_runtime_schema_ready(connection, migration_root=tmp_path)

    assert connection.executions[0][0].startswith("SELECT migration_name, migration_hash")
    checkpoint_queries = [entry for entry in connection.executions if entry[0] == "SELECT to_regclass(%s)"]
    assert [entry[1][0] for entry in checkpoint_queries] == list(CHECKPOINT_TABLES)


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

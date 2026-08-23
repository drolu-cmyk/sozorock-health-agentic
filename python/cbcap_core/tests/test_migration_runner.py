from contextlib import contextmanager
from pathlib import Path

import pytest

from cbcap_core.migration_runner import (
    MIGRATION_LOCK_ID,
    MIGRATION_TABLE,
    _apply_migrations,
    _migration_files,
    _transaction_body,
)


class Result:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, *, existing=None, fail_on_schema=False):
        self.existing = existing or {}
        self.fail_on_schema = fail_on_schema
        self.executions = []
        self.transactions = 0
        self.rollbacks = 0

    @contextmanager
    def transaction(self):
        self.transactions += 1
        try:
            yield
        except Exception:
            self.rollbacks += 1
            raise

    def execute(self, query, params=None, prepare=None):
        text = str(query)
        self.executions.append((text, params, prepare))
        if text.startswith(f"SELECT migration_hash FROM public.{MIGRATION_TABLE}"):
            name = params[0]
            value = self.existing.get(name)
            return Result((value,) if value is not None else None)
        if self.fail_on_schema and "CREATE TABLE sample" in text:
            raise RuntimeError("simulated schema failure")
        return Result()


def migration(path: Path, body: str = "CREATE TABLE sample (id integer);") -> None:
    path.write_text(f"BEGIN;\n\n{body}\n\nCOMMIT;\n", encoding="utf-8")


def test_migration_body_requires_explicit_outer_transaction_wrapper(tmp_path):
    valid = tmp_path / "001_valid.sql"
    migration(valid)
    assert _transaction_body(valid) == "CREATE TABLE sample (id integer);"

    missing_begin = tmp_path / "002_missing_begin.sql"
    missing_begin.write_text("CREATE TABLE sample (id integer);\nCOMMIT;\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="outer BEGIN/COMMIT"):
        _transaction_body(missing_begin)

    missing_commit = tmp_path / "003_missing_commit.sql"
    missing_commit.write_text("BEGIN;\nCREATE TABLE sample (id integer);\n", encoding="utf-8")
    with pytest.raises(RuntimeError, match="outer BEGIN/COMMIT"):
        _transaction_body(missing_commit)


def test_migration_files_must_be_contiguous_from_one(tmp_path):
    migration(tmp_path / "001_first.sql")
    migration(tmp_path / "003_gap.sql")
    with pytest.raises(RuntimeError, match="contiguous"):
        _migration_files(tmp_path)


def test_schema_and_ledger_are_applied_inside_one_serialized_transaction(tmp_path):
    migration(tmp_path / "001_first.sql")
    migration(tmp_path / "002_second.sql", "CREATE TABLE sample_two (id integer);")
    connection = FakeConnection()

    _apply_migrations(connection, tmp_path)

    assert connection.transactions == 1
    assert connection.rollbacks == 0
    assert connection.executions[0][0] == "SELECT pg_advisory_xact_lock(%s)"
    assert connection.executions[0][1] == (MIGRATION_LOCK_ID,)
    inserts = [item for item in connection.executions if item[0].startswith(f"INSERT INTO public.{MIGRATION_TABLE}")]
    assert len(inserts) == 2
    schema_positions = [
        index
        for index, item in enumerate(connection.executions)
        if "CREATE TABLE sample" in item[0]
    ]
    ledger_positions = [
        index
        for index, item in enumerate(connection.executions)
        if item[0].startswith(f"INSERT INTO public.{MIGRATION_TABLE}")
    ]
    assert schema_positions[0] < ledger_positions[0] < schema_positions[1] < ledger_positions[1]


def test_applied_migration_with_same_hash_is_skipped(tmp_path):
    path = tmp_path / "001_first.sql"
    migration(path)
    import hashlib

    digest = "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()
    connection = FakeConnection(existing={path.name: digest})

    _apply_migrations(connection, tmp_path)

    assert not any("CREATE TABLE sample" in item[0] for item in connection.executions)
    assert not any(item[0].startswith(f"INSERT INTO public.{MIGRATION_TABLE}") for item in connection.executions)


def test_applied_migration_hash_drift_fails_closed(tmp_path):
    path = tmp_path / "001_first.sql"
    migration(path)
    connection = FakeConnection(existing={path.name: "sha256:" + "0" * 64})

    with pytest.raises(RuntimeError, match="has changed"):
        _apply_migrations(connection, tmp_path)


def test_schema_failure_rolls_back_before_ledger_insert(tmp_path):
    migration(tmp_path / "001_first.sql")
    connection = FakeConnection(fail_on_schema=True)

    with pytest.raises(RuntimeError, match="simulated schema failure"):
        _apply_migrations(connection, tmp_path)

    assert connection.rollbacks == 1
    assert not any(item[0].startswith(f"INSERT INTO public.{MIGRATION_TABLE}") for item in connection.executions)

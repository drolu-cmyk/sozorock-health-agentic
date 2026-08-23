from pathlib import Path

import pytest

from cbcap_core.migration_runner import (
    RUNTIME_INSERT_TABLES,
    RUNTIME_SELECT_TABLES,
    RUNTIME_UPDATE_COLUMNS,
    _migration_files,
    _sha256,
)
from cbcap_core.schema_readiness import (
    CHECKPOINT_DATA_POLICIES,
    CHECKPOINT_TABLES,
    PUBLIC_RUNTIME_GRANTS,
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
        elif normalized.startswith("SELECT tablename, has_table_privilege"):
            schema_name = params[0]
            source = (
                self.connection.cbcap_grants
                if schema_name == "cbcap"
                else self.connection.public_grants
            )
            self.rows = [
                (table_name, *privileges)
                for table_name, privileges in sorted(source.items())
            ]
            self.row = None
        elif normalized.startswith("SELECT c.relname, a.attname, has_column_privilege"):
            all_columns = {
                ("county_run_identity", "run_id"),
                ("county_run_identity", "tenant_id"),
                ("county_run_identity", "geography_id"),
                ("county_run_state_version", "run_id"),
                ("workspace_membership_event", "principal_key"),
                ("tenant_evidence_document", "id"),
            }
            all_columns.update(self.connection.update_columns)
            self.rows = [
                (table_name, column_name, (table_name, column_name) in self.connection.update_columns)
                for table_name, column_name in sorted(all_columns)
            ]
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


def expected_update_columns():
    return {
        (table_name, column_name)
        for table_name, column_names in RUNTIME_UPDATE_COLUMNS.items()
        for column_name in column_names
    }


def default_cbcap_grants():
    table_names = {
        *RUNTIME_SELECT_TABLES,
        *RUNTIME_INSERT_TABLES,
        *RUNTIME_UPDATE_COLUMNS,
        "tenant_evidence_document",
        "tenant_evidence_review",
        "decision_memory",
        "publication_authorization",
        "forecast_model_registration",
    }
    return {
        table_name: (
            table_name in RUNTIME_SELECT_TABLES,
            table_name in RUNTIME_INSERT_TABLES,
            False,
            False,
        )
        for table_name in table_names
    }


def default_public_grants():
    return {
        qualified_name.split(".", 1)[1]: privileges
        for qualified_name, privileges in PUBLIC_RUNTIME_GRANTS.items()
    }


class Connection:
    def __init__(
        self,
        *,
        ledger,
        tables=CHECKPOINT_TABLES,
        isolation=None,
        cbcap_grants=None,
        public_grants=None,
        update_columns=None,
    ):
        self.ledger = ledger
        self.tables = set(tables)
        self.isolation = isolation or {
            table_name: (True, True, True)
            for table_name in CHECKPOINT_DATA_POLICIES
        }
        self.cbcap_grants = (
            default_cbcap_grants() if cbcap_grants is None else cbcap_grants
        )
        self.public_grants = (
            default_public_grants() if public_grants is None else public_grants
        )
        self.update_columns = (
            expected_update_columns() if update_columns is None else set(update_columns)
        )
        self.executions = []

    def cursor(self):
        return Cursor(self)


def migration(path: Path, body: str) -> None:
    path.write_text(f"BEGIN;\n{body}\nCOMMIT;\n", encoding="utf-8")


def expected_ledger(root: Path):
    return [(path.name, _sha256(path)) for path in _migration_files(root)]


def test_runtime_schema_ready_requires_exact_image_migrations_grants_tables_and_forced_rls(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    migration(tmp_path / "002_second.sql", "SELECT 2;")
    connection = Connection(ledger=expected_ledger(tmp_path))

    assert_runtime_schema_ready(connection, migration_root=tmp_path)

    assert connection.executions[0][0].startswith("SELECT migration_name, migration_hash")
    grant_queries = [
        entry
        for entry in connection.executions
        if entry[0].startswith("SELECT tablename, has_table_privilege")
    ]
    assert [entry[1][0] for entry in grant_queries] == ["cbcap", "public"]
    assert any(
        entry[0].startswith("SELECT c.relname, a.attname, has_column_privilege")
        for entry in connection.executions
    )
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


def test_runtime_schema_ready_rejects_membership_write_privilege(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    grants = default_cbcap_grants()
    grants["workspace_membership_event"] = (True, True, False, False)

    with pytest.raises(RuntimeError, match="privilege boundary"):
        assert_runtime_schema_ready(
            Connection(ledger=expected_ledger(tmp_path), cbcap_grants=grants),
            migration_root=tmp_path,
        )


def test_runtime_schema_ready_rejects_private_evidence_read_privilege(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    grants = default_cbcap_grants()
    grants["tenant_evidence_document"] = (True, False, False, False)

    with pytest.raises(RuntimeError, match="privilege boundary"):
        assert_runtime_schema_ready(
            Connection(ledger=expected_ledger(tmp_path), cbcap_grants=grants),
            migration_root=tmp_path,
        )


def test_runtime_schema_ready_rejects_missing_required_run_read_privilege(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    grants = default_cbcap_grants()
    grants["county_run_state_version"] = (False, True, False, False)

    with pytest.raises(RuntimeError, match="privilege boundary"):
        assert_runtime_schema_ready(
            Connection(ledger=expected_ledger(tmp_path), cbcap_grants=grants),
            migration_root=tmp_path,
        )


def test_runtime_schema_ready_rejects_table_level_update_or_delete_on_cbcap_tables(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    grants = default_cbcap_grants()
    grants["county_run_state_version"] = (True, True, True, False)

    with pytest.raises(RuntimeError, match="privilege boundary"):
        assert_runtime_schema_ready(
            Connection(ledger=expected_ledger(tmp_path), cbcap_grants=grants),
            migration_root=tmp_path,
        )


def test_runtime_schema_ready_requires_only_the_run_id_column_update_for_row_locking(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    ledger = expected_ledger(tmp_path)

    with pytest.raises(RuntimeError, match="privilege boundary"):
        assert_runtime_schema_ready(
            Connection(ledger=ledger, update_columns=set()),
            migration_root=tmp_path,
        )

    excessive = expected_update_columns() | {("county_run_identity", "tenant_id")}
    with pytest.raises(RuntimeError, match="privilege boundary"):
        assert_runtime_schema_ready(
            Connection(ledger=ledger, update_columns=excessive),
            migration_root=tmp_path,
        )


def test_runtime_schema_ready_rejects_checkpoint_or_ledger_grant_drift(tmp_path):
    migration(tmp_path / "001_first.sql", "SELECT 1;")
    grants = default_public_grants()
    grants["checkpoints"] = (True, False, True, True)

    with pytest.raises(RuntimeError, match="privilege boundary"):
        assert_runtime_schema_ready(
            Connection(ledger=expected_ledger(tmp_path), public_grants=grants),
            migration_root=tmp_path,
        )

    grants = default_public_grants()
    grants["cbcap_schema_migration"] = (True, True, False, False)
    with pytest.raises(RuntimeError, match="privilege boundary"):
        assert_runtime_schema_ready(
            Connection(ledger=expected_ledger(tmp_path), public_grants=grants),
            migration_root=tmp_path,
        )


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

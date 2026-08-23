from __future__ import annotations

import os
from pathlib import Path

from .migration_runner import (
    MIGRATION_TABLE,
    RUNTIME_INSERT_TABLES,
    RUNTIME_SELECT_TABLES,
    _migration_files,
    _sha256,
)
from .persistence import ConnectionLike

CHECKPOINT_DATA_POLICIES = {
    "public.checkpoints": "cbcap_checkpoint_tenant_isolation",
    "public.checkpoint_blobs": "cbcap_checkpoint_blob_tenant_isolation",
    "public.checkpoint_writes": "cbcap_checkpoint_write_tenant_isolation",
}
CHECKPOINT_TABLES = (
    *CHECKPOINT_DATA_POLICIES.keys(),
    "public.checkpoint_migrations",
)
PUBLIC_RUNTIME_GRANTS = {
    "public.checkpoints": (True, True, True, True),
    "public.checkpoint_blobs": (True, True, True, True),
    "public.checkpoint_writes": (True, True, True, True),
    "public.checkpoint_migrations": (True, False, False, False),
    f"public.{MIGRATION_TABLE}": (True, False, False, False),
}


def _table_grants(connection: ConnectionLike, schema_name: str) -> dict[str, tuple[bool, bool, bool, bool]]:
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT tablename,
                   has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'SELECT'),
                   has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'INSERT'),
                   has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'UPDATE'),
                   has_table_privilege(current_user, format('%I.%I', schemaname, tablename), 'DELETE')
              FROM pg_tables
             WHERE schemaname=%s
             ORDER BY tablename
            """,
            (schema_name,),
        )
        return {
            str(row[0]): (bool(row[1]), bool(row[2]), bool(row[3]), bool(row[4]))
            for row in cursor.fetchall()
        }


def _assert_runtime_cbcap_grants(connection: ConnectionLike) -> None:
    grants = _table_grants(connection, "cbcap")
    expected_select = set(RUNTIME_SELECT_TABLES)
    expected_insert = set(RUNTIME_INSERT_TABLES)
    required = expected_select | expected_insert
    if not required.issubset(grants):
        raise RuntimeError("runtime database privilege boundary is incomplete")

    for table_name, (can_select, can_insert, can_update, can_delete) in grants.items():
        expected = (
            table_name in expected_select,
            table_name in expected_insert,
            False,
            False,
        )
        if (can_select, can_insert, can_update, can_delete) != expected:
            raise RuntimeError("runtime database privilege boundary is incomplete")


def _assert_runtime_public_grants(connection: ConnectionLike) -> None:
    grants = _table_grants(connection, "public")
    for qualified_name, expected in PUBLIC_RUNTIME_GRANTS.items():
        _, table_name = qualified_name.split(".", 1)
        if grants.get(table_name) != expected:
            raise RuntimeError("runtime database privilege boundary is incomplete")


def assert_runtime_schema_ready(
    connection: ConnectionLike,
    *,
    migration_root: Path | None = None,
) -> None:
    """Fail closed unless database state exactly matches the running image.

    Liveness is intentionally separate from readiness. A task is ready only
    when every numbered CB-CAP migration bundled into its immutable image is
    present with the exact recorded hash, the runtime database principal has
    only the reviewed table privileges, and durable LangGraph checkpoint tables
    retain forced tenant RLS plus the expected policies. An older image against
    a newer database also fails closed, preventing accidental rollback across an
    incompatible schema boundary.
    """

    root = migration_root or Path(
        os.getenv("CB_CAP_MIGRATION_ROOT", "/app/sql")
    ).resolve()
    expected = [
        (path.name, _sha256(path))
        for path in _migration_files(root)
    ]

    with connection.cursor() as cursor:
        cursor.execute(
            f"SELECT migration_name, migration_hash FROM public.{MIGRATION_TABLE} ORDER BY migration_name"
        )
        actual = [tuple(row) for row in cursor.fetchall()]
    if actual != expected:
        raise RuntimeError("runtime database migration ledger does not match the running image")

    _assert_runtime_cbcap_grants(connection)
    _assert_runtime_public_grants(connection)

    with connection.cursor() as cursor:
        for table_name in CHECKPOINT_TABLES:
            cursor.execute("SELECT to_regclass(%s)", (table_name,))
            row = cursor.fetchone()
            if row is None or row[0] is None:
                raise RuntimeError("runtime checkpoint schema is incomplete")

        for qualified_name, policy_name in CHECKPOINT_DATA_POLICIES.items():
            schema_name, table_name = qualified_name.split(".", 1)
            cursor.execute(
                """
                SELECT c.relrowsecurity,
                       c.relforcerowsecurity,
                       EXISTS (
                         SELECT 1
                           FROM pg_policies p
                          WHERE p.schemaname=n.nspname
                            AND p.tablename=c.relname
                            AND p.policyname=%s
                       )
                  FROM pg_class c
                  JOIN pg_namespace n ON n.oid=c.relnamespace
                 WHERE n.nspname=%s AND c.relname=%s
                """,
                (policy_name, schema_name, table_name),
            )
            row = cursor.fetchone()
            if row is None or row != (True, True, True):
                raise RuntimeError("runtime checkpoint tenant isolation is incomplete")

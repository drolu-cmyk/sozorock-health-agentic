from __future__ import annotations

import os
from pathlib import Path

from .migration_runner import MIGRATION_TABLE, _migration_files, _sha256
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


def assert_runtime_schema_ready(
    connection: ConnectionLike,
    *,
    migration_root: Path | None = None,
) -> None:
    """Fail closed unless database state exactly matches the running image.

    Liveness is intentionally separate from readiness. A task is ready only
    when every numbered CB-CAP migration bundled into its immutable image is
    present with the exact recorded hash, the durable LangGraph checkpoint
    tables exist, and forced tenant RLS plus the expected policies remain active
    on every tenant-bearing checkpoint table. An older image against a newer
    database also fails closed, preventing accidental rollback across an
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

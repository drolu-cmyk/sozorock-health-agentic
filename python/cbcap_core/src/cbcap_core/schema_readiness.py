from __future__ import annotations

import os
from pathlib import Path

from .migration_runner import MIGRATION_TABLE, _migration_files, _sha256
from .persistence import ConnectionLike

CHECKPOINT_TABLES = (
    "public.checkpoints",
    "public.checkpoint_blobs",
    "public.checkpoint_writes",
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
    present with the exact recorded hash and the durable LangGraph checkpoint
    tables exist. An older image against a newer database also fails closed,
    preventing accidental rollback across an incompatible schema boundary.
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

from __future__ import annotations

import hashlib
import os
import re
from pathlib import Path
from urllib.parse import quote

import psycopg
from langgraph.checkpoint.postgres import PostgresSaver
from psycopg import sql

RUNTIME_ROLE = "cbcap_runtime"
MIGRATION_TABLE = "cbcap_schema_migration"
MIGRATION_LOCK_ID = 742915860231


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _database_url(*, username_env: str, password_env: str) -> str:
    host = _required_env("CB_CAP_DATABASE_HOST")
    database = _required_env("CB_CAP_DATABASE_NAME")
    username = _required_env(username_env)
    password = _required_env(password_env)
    port_raw = os.getenv("CB_CAP_DATABASE_PORT", "5432").strip()

    if not re.fullmatch(r"[A-Za-z0-9.-]+", host) or host.startswith(".") or host.endswith("."):
        raise RuntimeError("CB_CAP_DATABASE_HOST is invalid")
    if not re.fullmatch(r"[A-Za-z0-9_]+", database):
        raise RuntimeError("CB_CAP_DATABASE_NAME is invalid")
    try:
        port = int(port_raw)
    except ValueError as exc:
        raise RuntimeError("CB_CAP_DATABASE_PORT must be an integer") from exc
    if port < 1 or port > 65535:
        raise RuntimeError("CB_CAP_DATABASE_PORT is invalid")

    return (
        "postgresql://"
        f"{quote(username, safe='')}:{quote(password, safe='')}@"
        f"{host}:{port}/{quote(database, safe='')}?sslmode=require"
    )


def _migration_files(root: Path) -> list[Path]:
    files = sorted(
        path
        for path in root.glob("[0-9][0-9][0-9]_*.sql")
        if path.is_file()
    )
    if not files:
        raise RuntimeError("no CB-CAP SQL migrations were found")
    numbers = [int(path.name[:3]) for path in files]
    expected = list(range(numbers[0], numbers[-1] + 1))
    if numbers != expected or numbers[0] != 1:
        raise RuntimeError("CB-CAP SQL migration numbers must be contiguous starting at 001")
    return files


def _sha256(path: Path) -> str:
    return "sha256:" + hashlib.sha256(path.read_bytes()).hexdigest()


def _transaction_body(path: Path) -> str:
    """Return a migration body whose transaction is owned by the runner.

    Numbered migration files remain readable, standalone SQL artifacts with an
    explicit outer BEGIN/COMMIT. The production runner removes only that outer
    wrapper so the schema changes and migration-ledger insert can commit as one
    transaction. This closes the crash window where a migration could commit
    successfully but remain unrecorded.
    """

    script = path.read_text(encoding="utf-8")
    if not script.strip():
        raise RuntimeError(f"migration {path.name} is empty")
    lines = script.strip().splitlines()
    if len(lines) < 3 or lines[0].strip().upper() != "BEGIN;" or lines[-1].strip().upper() != "COMMIT;":
        raise RuntimeError(
            f"migration {path.name} must have one explicit outer BEGIN/COMMIT wrapper"
        )
    body = "\n".join(lines[1:-1]).strip()
    if not body:
        raise RuntimeError(f"migration {path.name} has an empty transaction body")
    return body


def _ensure_migration_ledger(connection: psycopg.Connection) -> None:
    connection.execute(
        f"""
        CREATE TABLE IF NOT EXISTS public.{MIGRATION_TABLE} (
          migration_name text PRIMARY KEY,
          migration_hash text NOT NULL CHECK (migration_hash ~ '^sha256:[0-9a-f]{{64}}$'),
          applied_at timestamptz NOT NULL DEFAULT now()
        )
        """
    )
    connection.execute(
        f"REVOKE ALL ON TABLE public.{MIGRATION_TABLE} FROM PUBLIC"
    )


def _apply_migrations(connection: psycopg.Connection, root: Path) -> None:
    files = _migration_files(root)
    with connection.transaction():
        connection.execute("SELECT pg_advisory_xact_lock(%s)", (MIGRATION_LOCK_ID,))
        _ensure_migration_ledger(connection)

        for path in files:
            digest = _sha256(path)
            existing = connection.execute(
                f"SELECT migration_hash FROM public.{MIGRATION_TABLE} WHERE migration_name=%s",
                (path.name,),
            ).fetchone()
            if existing is not None:
                if existing[0] != digest:
                    raise RuntimeError(
                        f"applied migration {path.name} has changed; append a new migration instead"
                    )
                continue

            connection.execute(_transaction_body(path), prepare=False)
            connection.execute(
                f"INSERT INTO public.{MIGRATION_TABLE} (migration_name, migration_hash) VALUES (%s,%s)",
                (path.name, digest),
            )


def _ensure_runtime_role(
    connection: psycopg.Connection,
    *,
    runtime_password: str,
    database_name: str,
) -> None:
    exists = connection.execute(
        "SELECT 1 FROM pg_roles WHERE rolname=%s",
        (RUNTIME_ROLE,),
    ).fetchone()
    role = sql.Identifier(RUNTIME_ROLE)
    if exists is None:
        connection.execute(
            sql.SQL("CREATE ROLE {} LOGIN PASSWORD %s").format(role),
            (runtime_password,),
        )
    else:
        connection.execute(
            sql.SQL("ALTER ROLE {} PASSWORD %s").format(role),
            (runtime_password,),
        )

    connection.execute(
        sql.SQL(
            "ALTER ROLE {} NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS"
        ).format(role)
    )
    connection.execute(
        sql.SQL("GRANT CONNECT ON DATABASE {} TO {}").format(
            sql.Identifier(database_name), role
        )
    )
    connection.execute(sql.SQL("GRANT USAGE ON SCHEMA cbcap TO {}").format(role))
    connection.execute(
        sql.SQL("GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA cbcap TO {}").format(role)
    )
    connection.execute(
        sql.SQL(
            "ALTER DEFAULT PRIVILEGES IN SCHEMA cbcap GRANT SELECT, INSERT ON TABLES TO {}"
        ).format(role)
    )


def _setup_checkpoint_schema(master_url: str, connection: psycopg.Connection) -> None:
    with PostgresSaver.from_conn_string(master_url) as checkpointer:
        checkpointer.setup()

    role = sql.Identifier(RUNTIME_ROLE)
    connection.execute(sql.SQL("GRANT USAGE ON SCHEMA public TO {}").format(role))
    connection.execute(
        sql.SQL(f"GRANT SELECT ON TABLE public.{MIGRATION_TABLE} TO {{}}").format(role)
    )
    for table_name in ("checkpoints", "checkpoint_blobs", "checkpoint_writes"):
        if connection.execute("SELECT to_regclass(%s)", (f"public.{table_name}",)).fetchone()[0]:
            connection.execute(
                sql.SQL("GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE {}.{} TO {}").format(
                    sql.Identifier("public"), sql.Identifier(table_name), role
                )
            )
    if connection.execute(
        "SELECT to_regclass('public.checkpoint_migrations')"
    ).fetchone()[0]:
        connection.execute(
            sql.SQL("GRANT SELECT ON TABLE public.checkpoint_migrations TO {}").format(role)
        )


def run_migrations() -> None:
    root = Path(os.getenv("CB_CAP_MIGRATION_ROOT", "/app/sql")).resolve()
    database_name = _required_env("CB_CAP_DATABASE_NAME")
    runtime_password = _required_env("CB_CAP_DATABASE_PASSWORD")
    master_url = _database_url(
        username_env="CB_CAP_MIGRATION_DATABASE_USERNAME",
        password_env="CB_CAP_MIGRATION_DATABASE_PASSWORD",
    )

    with psycopg.connect(master_url, autocommit=True) as connection:
        _apply_migrations(connection, root)
        with connection.transaction():
            _ensure_runtime_role(
                connection,
                runtime_password=runtime_password,
                database_name=database_name,
            )
        _setup_checkpoint_schema(master_url, connection)


if __name__ == "__main__":
    run_migrations()

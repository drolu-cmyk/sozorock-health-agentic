from __future__ import annotations

import os
from contextlib import contextmanager
from dataclasses import dataclass
from urllib.parse import parse_qs, urlparse


@dataclass(frozen=True)
class CheckpointSettings:
    database_url: str
    require_encryption: bool = True
    allow_insecure_database: bool = False

    @classmethod
    def from_env(cls) -> "CheckpointSettings":
        database_url = os.getenv("CB_CAP_CHECKPOINT_DATABASE_URL", "").strip()
        if not database_url:
            raise RuntimeError("CB_CAP_CHECKPOINT_DATABASE_URL is required for durable checkpoints")
        require_encryption = os.getenv("CB_CAP_REQUIRE_CHECKPOINT_ENCRYPTION", "true").lower() != "false"
        allow_insecure_database = os.getenv("CB_CAP_ALLOW_INSECURE_CHECKPOINT_DB", "false").lower() == "true"
        return cls(
            database_url=database_url,
            require_encryption=require_encryption,
            allow_insecure_database=allow_insecure_database,
        )

    def validate(self) -> None:
        parsed = urlparse(self.database_url)
        if parsed.scheme not in {"postgresql", "postgres"}:
            raise RuntimeError("durable checkpoint database must use PostgreSQL")
        if not parsed.hostname:
            raise RuntimeError("checkpoint database URL must include a host")

        query = parse_qs(parsed.query)
        sslmode = (query.get("sslmode") or [""])[0].lower()
        if not self.allow_insecure_database and sslmode in {"", "disable", "allow", "prefer"}:
            raise RuntimeError(
                "checkpoint database must require TLS; set sslmode=require, verify-ca, or verify-full"
            )

        if self.require_encryption:
            key = os.getenv("LANGGRAPH_AES_KEY", "").encode("utf-8")
            if len(key) not in {16, 24, 32}:
                raise RuntimeError("LANGGRAPH_AES_KEY must be 16, 24, or 32 bytes")


def checkpoint_thread_config(run_id: str, *, tenant_id: str | None = None) -> dict:
    """Build a stable LangGraph thread identifier without embedding user content."""

    run_id = run_id.strip()
    if not run_id:
        raise ValueError("run_id is required")
    scope = tenant_id.strip() if tenant_id else "foundation"
    if not scope:
        raise ValueError("tenant_id cannot be blank")
    return {"configurable": {"thread_id": f"cbcap:{scope}:county-run:{run_id}"}}


@contextmanager
def postgres_checkpointer(
    settings: CheckpointSettings | None = None,
    *,
    tenant_id: str,
    setup: bool = False,
):
    """Yield an encrypted, tenant-scoped PostgresSaver for production.

    LangGraph's synchronous `from_conn_string` helper does not accept a custom
    serializer. The production path therefore opens the supported psycopg
    connection directly and passes the encrypted serializer to the
    `PostgresSaver` constructor. Tenant scope is set on the checkpoint
    connection before any graph read or write so database RLS can independently
    enforce the same tenant boundary as the application state tables.
    """

    resolved = settings or CheckpointSettings.from_env()
    resolved.validate()
    tenant_id = tenant_id.strip()
    if not tenant_id:
        raise ValueError("tenant_id is required for durable checkpoints")

    # Restrict checkpoint deserialization to known-safe msgpack types. This is
    # defense in depth if the checkpoint database is ever compromised.
    os.environ["LANGGRAPH_STRICT_MSGPACK"] = "true"

    try:
        from langgraph.checkpoint.postgres import PostgresSaver
        from langgraph.checkpoint.serde.encrypted import EncryptedSerializer
        from psycopg import Connection
        from psycopg.rows import dict_row
    except ImportError as exc:
        raise RuntimeError(
            "Install cbcap-core[production] to use durable PostgreSQL checkpoints"
        ) from exc

    serde = None
    if resolved.require_encryption:
        serde = EncryptedSerializer.from_pycryptodome_aes()

    with Connection.connect(
        resolved.database_url,
        autocommit=True,
        prepare_threshold=0,
        row_factory=dict_row,
    ) as connection:
        connection.execute(
            "SELECT set_config('app.tenant_id', %s, false)",
            (tenant_id,),
        )
        checkpointer = PostgresSaver(connection, serde=serde)
        if setup:
            checkpointer.setup()
        yield checkpointer

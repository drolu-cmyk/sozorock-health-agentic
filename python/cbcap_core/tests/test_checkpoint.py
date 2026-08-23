import pytest

from cbcap_core.checkpoint import (
    CheckpointSettings,
    checkpoint_thread_config,
    postgres_checkpointer,
)


def test_checkpoint_settings_require_postgres():
    with pytest.raises(RuntimeError, match="PostgreSQL"):
        CheckpointSettings(
            database_url="mysql://db.example.org/cbcap?sslmode=require",
            require_encryption=False,
        ).validate()


def test_checkpoint_settings_require_tls_by_default():
    with pytest.raises(RuntimeError, match="must require TLS"):
        CheckpointSettings(
            database_url="postgresql://db.example.org/cbcap?sslmode=disable",
            require_encryption=False,
        ).validate()


def test_checkpoint_settings_accept_tls_without_app_encryption():
    CheckpointSettings(
        database_url="postgresql://db.example.org/cbcap?sslmode=verify-full",
        require_encryption=False,
    ).validate()


def test_checkpoint_thread_id_contains_only_scope_and_run_identity():
    assert checkpoint_thread_config("run-123", tenant_id="tenant-7") == {
        "configurable": {"thread_id": "cbcap:tenant-7:county-run:run-123"}
    }


def test_production_checkpointer_uses_supported_constructor_and_sets_tenant_session(monkeypatch):
    import langgraph.checkpoint.postgres as postgres_module
    import langgraph.checkpoint.serde.encrypted as encrypted_module
    import psycopg

    events = []
    encrypted_serde = object()

    class FakeDatabaseConnection:
        def __enter__(self):
            events.append(("connection_enter",))
            return self

        def __exit__(self, exc_type, exc, tb):
            events.append(("connection_exit",))
            return False

        def execute(self, query, params=None):
            events.append(("execute", query, params))

    class FakeConnectionFactory:
        @classmethod
        def connect(cls, database_url, **kwargs):
            events.append(("connect", database_url, kwargs))
            return FakeDatabaseConnection()

    class FakeEncryptedSerializer:
        @classmethod
        def from_pycryptodome_aes(cls):
            events.append(("encrypted_serializer",))
            return encrypted_serde

    class FakePostgresSaver:
        def __init__(self, connection, *, serde=None):
            events.append(("saver_init", connection, serde))
            self.connection = connection
            self.serde = serde
            self.setup_called = False

        @classmethod
        def from_conn_string(cls, *args, **kwargs):
            raise AssertionError("production checkpointer must not pass serde to from_conn_string")

        def setup(self):
            self.setup_called = True
            events.append(("setup",))

    monkeypatch.setattr(psycopg, "Connection", FakeConnectionFactory)
    monkeypatch.setattr(postgres_module, "PostgresSaver", FakePostgresSaver)
    monkeypatch.setattr(encrypted_module, "EncryptedSerializer", FakeEncryptedSerializer)
    monkeypatch.setenv("LANGGRAPH_AES_KEY", "0123456789abcdef0123456789abcdef")

    settings = CheckpointSettings(
        database_url="postgresql://runtime:secret@db.example.test:5432/cbcap?sslmode=require",
        require_encryption=True,
    )
    with postgres_checkpointer(settings, tenant_id="tenant:albany", setup=True) as saver:
        assert saver.serde is encrypted_serde
        assert saver.setup_called is True

    connect = next(item for item in events if item[0] == "connect")
    assert connect[2]["autocommit"] is True
    assert connect[2]["prepare_threshold"] == 0
    tenant_scope = next(item for item in events if item[0] == "execute")
    assert tenant_scope[1] == "SELECT set_config('app.tenant_id', %s, false)"
    assert tenant_scope[2] == ("tenant:albany",)
    assert any(item[0] == "saver_init" and item[2] is encrypted_serde for item in events)


def test_production_checkpointer_requires_explicit_tenant_scope():
    settings = CheckpointSettings(
        database_url="postgresql://runtime:secret@db.example.test:5432/cbcap?sslmode=require",
        require_encryption=False,
    )
    with pytest.raises(ValueError, match="tenant_id is required"):
        with postgres_checkpointer(settings, tenant_id="  "):
            pass

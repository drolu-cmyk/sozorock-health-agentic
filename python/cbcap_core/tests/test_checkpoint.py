import pytest

from cbcap_core.checkpoint import CheckpointSettings, checkpoint_thread_config


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

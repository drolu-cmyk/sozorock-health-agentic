import os

import pytest

from cbcap_core.runtime_bootstrap import (
    build_postgres_tls_url_from_components,
    prepare_runtime_database_environment,
)


def set_components(monkeypatch, **updates):
    values = {
        "CB_CAP_DATABASE_HOST": "cbcap-db.example.us-east-1.rds.amazonaws.com",
        "CB_CAP_DATABASE_NAME": "cbcap",
        "CB_CAP_DATABASE_USERNAME": "cbcap_admin",
        "CB_CAP_DATABASE_PASSWORD": "p@ss:/?#[] secret",
        "CB_CAP_DATABASE_PORT": "5432",
    }
    values.update(updates)
    for key, value in values.items():
        monkeypatch.setenv(key, value)


def test_component_database_url_is_escaped_and_tls_required(monkeypatch):
    set_components(monkeypatch)
    url = build_postgres_tls_url_from_components()
    assert url.startswith("postgresql://cbcap_admin:")
    assert "p@ss:/?#[] secret" not in url
    assert "p%40ss%3A%2F%3F%23%5B%5D%20secret" in url
    assert "@cbcap-db.example.us-east-1.rds.amazonaws.com:5432/cbcap" in url
    assert url.endswith("?sslmode=require")


def test_component_mode_populates_primary_and_checkpoint_urls_without_overwriting_explicit_url(monkeypatch):
    set_components(monkeypatch)
    monkeypatch.delenv("CB_CAP_DATABASE_URL", raising=False)
    monkeypatch.delenv("CB_CAP_CHECKPOINT_DATABASE_URL", raising=False)

    prepare_runtime_database_environment()
    primary = os.environ["CB_CAP_DATABASE_URL"]
    assert primary.endswith("?sslmode=require")
    assert os.environ["CB_CAP_CHECKPOINT_DATABASE_URL"] == primary

    monkeypatch.setenv(
        "CB_CAP_DATABASE_URL",
        "postgresql://explicit:secret@explicit.example.test:5432/cbcap?sslmode=verify-full",
    )
    monkeypatch.setenv(
        "CB_CAP_CHECKPOINT_DATABASE_URL",
        "postgresql://checkpoint:secret@checkpoint.example.test:5432/cbcap?sslmode=verify-full",
    )
    prepare_runtime_database_environment()
    assert os.environ["CB_CAP_DATABASE_URL"].startswith("postgresql://explicit:")
    assert os.environ["CB_CAP_CHECKPOINT_DATABASE_URL"].startswith("postgresql://checkpoint:")


@pytest.mark.parametrize(
    ("updates", "message"),
    [
        ({"CB_CAP_DATABASE_HOST": "https://bad-host.example"}, "HOST"),
        ({"CB_CAP_DATABASE_NAME": "cbcap;drop"}, "NAME"),
        ({"CB_CAP_DATABASE_PORT": "not-a-port"}, "PORT"),
        ({"CB_CAP_DATABASE_PORT": "70000"}, "PORT"),
    ],
)
def test_invalid_database_components_fail_closed(monkeypatch, updates, message):
    set_components(monkeypatch, **updates)
    with pytest.raises(RuntimeError, match=message):
        build_postgres_tls_url_from_components()


def test_partial_component_mode_never_falls_back_to_an_insecure_or_blank_url(monkeypatch):
    monkeypatch.delenv("CB_CAP_DATABASE_URL", raising=False)
    monkeypatch.delenv("CB_CAP_CHECKPOINT_DATABASE_URL", raising=False)
    monkeypatch.setenv("CB_CAP_DATABASE_HOST", "db.example.test")
    monkeypatch.delenv("CB_CAP_DATABASE_NAME", raising=False)
    monkeypatch.delenv("CB_CAP_DATABASE_USERNAME", raising=False)
    monkeypatch.delenv("CB_CAP_DATABASE_PASSWORD", raising=False)

    with pytest.raises(RuntimeError, match="CB_CAP_DATABASE_NAME"):
        prepare_runtime_database_environment()

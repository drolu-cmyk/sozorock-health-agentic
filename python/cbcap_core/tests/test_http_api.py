from __future__ import annotations

from datetime import datetime, timedelta, timezone

import pytest
from fastapi import HTTPException
from starlette.requests import Request

from cbcap_core.cognito_identity import CognitoAuthenticationError
from cbcap_core.http_api import (
    RuntimeApiSettings,
    _access_token,
    _safe_http_error,
    app,
    runtime_dependencies,
)


def request_with_headers(headers: list[tuple[bytes, bytes]]) -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/",
            "headers": headers,
            "query_string": b"",
            "server": ("testserver", 443),
            "client": ("127.0.0.1", 12345),
            "scheme": "https",
        }
    )


def test_bearer_parser_accepts_exact_two_part_authorization_header():
    request = request_with_headers([(b"authorization", b"Bearer header.payload.signature")])
    assert _access_token(request) == "header.payload.signature"


@pytest.mark.parametrize(
    "authorization",
    [
        b"",
        b"Basic abc",
        b"Bearer",
        b"Bearer one two",
        b"Token abc",
    ],
)
def test_bearer_parser_rejects_missing_or_malformed_credentials(authorization):
    headers = [] if not authorization else [(b"authorization", authorization)]
    with pytest.raises(HTTPException) as captured:
        _access_token(request_with_headers(headers))
    assert captured.value.status_code == 401
    assert captured.value.detail == "authentication_required"
    assert captured.value.headers == {"WWW-Authenticate": "Bearer"}


def test_http_error_mapping_does_not_expose_authentication_or_authorization_messages():
    authentication = _safe_http_error(
        CognitoAuthenticationError("token contained secret diagnostic material")
    )
    assert authentication.status_code == 401
    assert authentication.detail == "authentication_failed"
    assert authentication.headers == {"WWW-Authenticate": "Bearer"}

    authorization = _safe_http_error(
        PermissionError("principal has hidden tenant membership detail")
    )
    assert authorization.status_code == 403
    assert authorization.detail == "not_authorized"
    assert "tenant" not in str(authorization.detail)


def test_http_error_mapping_keeps_runtime_diagnostics_private():
    not_found = _safe_http_error(LookupError("internal run id or table missing"))
    invalid = _safe_http_error(ValueError("sensitive validation context"))
    unavailable = _safe_http_error(RuntimeError("database hostname and secret context"))

    assert (not_found.status_code, not_found.detail) == (404, "run_not_found")
    assert (invalid.status_code, invalid.detail) == (422, "invalid_request")
    assert (unavailable.status_code, unavailable.detail) == (503, "runtime_unavailable")


def test_runtime_app_disables_interactive_schema_surfaces():
    assert app.docs_url is None
    assert app.redoc_url is None
    assert app.openapi_url is None


def test_runtime_settings_are_server_owned_and_default_to_zero_model_spend(monkeypatch):
    monkeypatch.setenv(
        "CB_CAP_DATABASE_URL",
        "postgresql://runtime:secret@db.example.test:5432/cbcap?sslmode=require",
    )
    monkeypatch.setenv(
        "CB_CAP_CHECKPOINT_DATABASE_URL",
        "postgresql://checkpoint:secret@db.example.test:5432/cbcap?sslmode=require",
    )
    monkeypatch.setenv("LANGGRAPH_AES_KEY", "0123456789abcdef0123456789abcdef")
    monkeypatch.setenv("CB_CAP_COGNITO_REGION", "us-east-1")
    monkeypatch.setenv("CB_CAP_COGNITO_USER_POOL_ID", "us-east-1_Example123")
    monkeypatch.setenv("CB_CAP_COGNITO_APP_CLIENT_ID", "client-example-123")
    monkeypatch.setenv("CB_CAP_COGNITO_REQUIRED_SCOPES", "cbcap/workspace")
    monkeypatch.setenv(
        "CB_CAP_EVIDENCE_GATEWAY_URL",
        "https://health.sozorockfoundation.org/api/evidence/v1/gateway",
    )
    monkeypatch.delenv("CB_CAP_MAX_MODEL_TOKENS", raising=False)
    monkeypatch.delenv("CB_CAP_MAX_MODEL_COST_USD", raising=False)

    settings = RuntimeApiSettings.from_env()

    assert settings.cognito.issuer == (
        "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example123"
    )
    assert settings.cognito.required_scopes == ["cbcap/workspace"]
    assert settings.identity_policy.trusted_issuers == [settings.cognito.issuer]
    assert settings.evidence_gateway_url.endswith("/api/evidence/v1/gateway")
    assert settings.run_budget.max_model_tokens == 0
    assert settings.run_budget.max_model_cost_usd == 0.0
    assert settings.run_budget.max_external_calls == 12


def test_runtime_settings_reject_non_tls_durable_databases(monkeypatch):
    monkeypatch.setenv(
        "CB_CAP_DATABASE_URL",
        "postgresql://runtime:secret@db.example.test:5432/cbcap?sslmode=disable",
    )
    monkeypatch.setenv(
        "CB_CAP_CHECKPOINT_DATABASE_URL",
        "postgresql://checkpoint:secret@db.example.test:5432/cbcap?sslmode=require",
    )
    monkeypatch.setenv("LANGGRAPH_AES_KEY", "0123456789abcdef0123456789abcdef")
    monkeypatch.setenv("CB_CAP_COGNITO_REGION", "us-east-1")
    monkeypatch.setenv("CB_CAP_COGNITO_USER_POOL_ID", "us-east-1_Example123")
    monkeypatch.setenv("CB_CAP_COGNITO_APP_CLIENT_ID", "client-example-123")
    monkeypatch.setenv(
        "CB_CAP_EVIDENCE_GATEWAY_URL",
        "https://health.sozorockfoundation.org/api/evidence/v1/gateway",
    )
    monkeypatch.delenv("CB_CAP_ALLOW_INSECURE_DATABASE", raising=False)

    with pytest.raises(RuntimeError, match="require TLS"):
        RuntimeApiSettings.from_env()


def test_runtime_dependency_cache_is_explicitly_clearable_for_process_reconfiguration():
    runtime_dependencies.cache_clear()
    assert runtime_dependencies.cache_info().currsize == 0

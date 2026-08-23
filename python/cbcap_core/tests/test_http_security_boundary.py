import asyncio
import inspect

import pytest
from fastapi.middleware.cors import CORSMiddleware
from starlette.requests import Request
from starlette.responses import Response

from cbcap_core.http_api import (
    _allowed_origins,
    _safe_http_error,
    app,
    execute_run,
    review_run,
    security_response_headers,
)
from cbcap_core.runtime_request import RunStateConflict


def request() -> Request:
    return Request(
        {
            "type": "http",
            "method": "GET",
            "path": "/healthz",
            "headers": [],
            "query_string": b"",
            "server": ("api.cbcap.sozorockfoundation.org", 443),
            "client": ("127.0.0.1", 12345),
            "scheme": "https",
        }
    )


def test_browser_origin_defaults_to_only_the_cbcap_workspace(monkeypatch):
    monkeypatch.delenv("CB_CAP_ALLOWED_ORIGINS", raising=False)
    assert _allowed_origins() == ["https://cbcap.sozorockfoundation.org"]
    assert any(getattr(item, "cls", None) is CORSMiddleware for item in app.user_middleware)


@pytest.mark.parametrize(
    "value",
    [
        "*",
        "http://cbcap.sozorockfoundation.org",
        "https://cbcap.sozorockfoundation.org/",
        "https://cbcap.sozorockfoundation.org,https://cbcap.sozorockfoundation.org",
        "https://cbcap.sozorockfoundation.org, https://bad origin.example",
    ],
)
def test_browser_origin_allowlist_rejects_unsafe_or_ambiguous_values(monkeypatch, value):
    monkeypatch.setenv("CB_CAP_ALLOWED_ORIGINS", value)
    with pytest.raises(RuntimeError, match="CB_CAP_ALLOWED_ORIGINS"):
        _allowed_origins()


def test_security_middleware_adds_noncache_clickjacking_transport_and_feature_headers():
    async def call_next(_request):
        return Response("ok", status_code=200)

    response = asyncio.run(security_response_headers(request(), call_next))

    assert response.headers["cache-control"] == "no-store"
    assert response.headers["pragma"] == "no-cache"
    assert response.headers["strict-transport-security"] == "max-age=31536000; includeSubDomains"
    assert response.headers["content-security-policy"] == "default-src 'none'; frame-ancestors 'none'; base-uri 'none'"
    assert response.headers["x-content-type-options"] == "nosniff"
    assert response.headers["x-frame-options"] == "DENY"
    assert response.headers["referrer-policy"] == "no-referrer"
    assert response.headers["permissions-policy"] == "camera=(), microphone=(), geolocation=()"
    assert response.headers["x-request-id"].startswith("request:")


def test_invalid_run_lifecycle_maps_to_safe_http_409():
    error = _safe_http_error(RunStateConflict("internal state detail"))
    assert error.status_code == 409
    assert error.detail == "run_state_conflict"
    assert "internal" not in str(error.detail)


def test_mutating_http_routes_authorize_and_gate_before_opening_checkpoint_storage():
    for endpoint, operation in ((execute_run, '"execute"'), (review_run, '"review"')):
        source = inspect.getsource(endpoint)
        authorization_index = source.index("authorize_server_owned_run(")
        lifecycle_index = source.index(f"require_run_operation_state(authorized.run, {operation})")
        checkpoint_index = source.index("with postgres_checkpointer(")
        graph_index = source.index("build_county_planning_graph(checkpointer=checkpointer)")

        assert authorization_index < lifecycle_index < checkpoint_index < graph_index
        assert "tenant_id=authorized.actor.tenant_id" in source
        assert "lock_for_mutation=True" in source

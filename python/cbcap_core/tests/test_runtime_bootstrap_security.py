import sys
from types import SimpleNamespace

from cbcap_core.runtime_bootstrap import main


def test_runtime_bootstrap_disables_server_banner_and_adds_hsts(monkeypatch):
    calls = []

    def run(*args, **kwargs):
        calls.append((args, kwargs))

    monkeypatch.setenv(
        "CB_CAP_DATABASE_URL",
        "postgresql://runtime:secret@db.internal:5432/cbcap?sslmode=require",
    )
    monkeypatch.delenv("CB_CAP_CHECKPOINT_DATABASE_URL", raising=False)
    monkeypatch.setenv("PORT", "8080")
    monkeypatch.setitem(sys.modules, "uvicorn", SimpleNamespace(run=run))

    main()

    assert len(calls) == 1
    args, kwargs = calls[0]
    assert args == ("cbcap_core.http_api:app",)
    assert kwargs["host"] == "0.0.0.0"
    assert kwargs["port"] == 8080
    assert kwargs["workers"] == 1
    assert kwargs["access_log"] is False
    assert kwargs["server_header"] is False
    assert ("Strict-Transport-Security", "max-age=31536000") in kwargs["headers"]

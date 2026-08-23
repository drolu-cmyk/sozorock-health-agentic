from __future__ import annotations

import os
import re
from urllib.parse import quote


def _required_component(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required when component-based database configuration is used")
    return value


def build_postgres_tls_url_from_components() -> str:
    host = _required_component("CB_CAP_DATABASE_HOST")
    database = _required_component("CB_CAP_DATABASE_NAME")
    username = _required_component("CB_CAP_DATABASE_USERNAME")
    password = _required_component("CB_CAP_DATABASE_PASSWORD")
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


def prepare_runtime_database_environment() -> None:
    """Prepare durable database URLs without logging or persisting credentials.

    Production ECS injects only the RDS password from Secrets Manager. If a
    complete URL is already provided, this function leaves it untouched. The
    checkpoint store defaults to the same TLS RDS database unless explicitly
    separated later.
    """

    explicit = os.getenv("CB_CAP_DATABASE_URL", "").strip()
    component_names = (
        "CB_CAP_DATABASE_HOST",
        "CB_CAP_DATABASE_NAME",
        "CB_CAP_DATABASE_USERNAME",
        "CB_CAP_DATABASE_PASSWORD",
    )
    component_mode = any(os.getenv(name, "").strip() for name in component_names)

    if not explicit and component_mode:
        explicit = build_postgres_tls_url_from_components()
        os.environ["CB_CAP_DATABASE_URL"] = explicit

    if explicit and not os.getenv("CB_CAP_CHECKPOINT_DATABASE_URL", "").strip():
        os.environ["CB_CAP_CHECKPOINT_DATABASE_URL"] = explicit


def main() -> None:
    prepare_runtime_database_environment()
    import uvicorn

    uvicorn.run(
        "cbcap_core.http_api:app",
        host="0.0.0.0",
        port=int(os.getenv("PORT", "8080")),
        workers=1,
        access_log=False,
        server_header=False,
    )


if __name__ == "__main__":
    main()

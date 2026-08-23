from __future__ import annotations

import os
from dataclasses import dataclass
from functools import lru_cache
from typing import Literal
from uuid import uuid4

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from pydantic import Field

from .checkpoint import CheckpointSettings, postgres_checkpointer
from .cognito_identity import (
    CognitoAccessTokenVerifier,
    CognitoAuthenticationError,
    CognitoVerifierSettings,
)
from .gateway_transport import EvidenceGatewayHttpClient
from .graph import RunBudget, build_county_planning_graph
from .identity_adapter import IdentityProjectionPolicy
from .models import CountyRunState, StrictModel
from .persistence import PersistenceSettings, postgres_connection
from .runtime_registry import append_county_run_state
from .runtime_request import authorize_server_owned_run, create_server_owned_run
from .runtime_service import execute_county_run, resume_county_run_review

ReviewDecision = Literal["approved", "rejected", "needs_revision", "deferred"]


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _int_env(name: str, default: int, *, minimum: int, maximum: int) -> int:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = int(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be an integer") from exc
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _float_env(name: str, default: float, *, minimum: float, maximum: float) -> float:
    raw = os.getenv(name, str(default)).strip()
    try:
        value = float(raw)
    except ValueError as exc:
        raise RuntimeError(f"{name} must be numeric") from exc
    if value < minimum or value > maximum:
        raise RuntimeError(f"{name} must be between {minimum} and {maximum}")
    return value


def _scope_env(name: str) -> list[str]:
    raw = os.getenv(name, "").strip()
    if not raw:
        return []
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if len(set(values)) != len(values):
        raise RuntimeError(f"{name} must not contain duplicate scopes")
    return values


@dataclass(frozen=True)
class RuntimeApiSettings:
    persistence: PersistenceSettings
    checkpoint: CheckpointSettings
    cognito: CognitoVerifierSettings
    identity_policy: IdentityProjectionPolicy
    evidence_gateway_url: str
    run_budget: RunBudget

    @classmethod
    def from_env(cls) -> "RuntimeApiSettings":
        cognito = CognitoVerifierSettings(
            region=_required_env("CB_CAP_COGNITO_REGION"),
            user_pool_id=_required_env("CB_CAP_COGNITO_USER_POOL_ID"),
            app_client_id=_required_env("CB_CAP_COGNITO_APP_CLIENT_ID"),
            required_scopes=_scope_env("CB_CAP_COGNITO_REQUIRED_SCOPES"),
            resource_audience=os.getenv("CB_CAP_COGNITO_RESOURCE_AUDIENCE", "").strip() or None,
            jwks_cache_seconds=_int_env(
                "CB_CAP_COGNITO_JWKS_CACHE_SECONDS", 300, minimum=60, maximum=3600
            ),
            jwks_timeout_seconds=_float_env(
                "CB_CAP_COGNITO_JWKS_TIMEOUT_SECONDS", 5.0, minimum=0.5, maximum=30.0
            ),
            max_token_bytes=_int_env(
                "CB_CAP_COGNITO_MAX_TOKEN_BYTES", 16384, minimum=1024, maximum=65536
            ),
        )
        identity_policy = IdentityProjectionPolicy(
            trusted_issuers=[cognito.issuer],
            grant_ttl_seconds=_int_env(
                "CB_CAP_IDENTITY_GRANT_TTL_SECONDS", 900, minimum=60, maximum=3600
            ),
            max_auth_age_seconds=_int_env(
                "CB_CAP_IDENTITY_MAX_AUTH_AGE_SECONDS", 43200, minimum=60, maximum=86400
            ),
        )
        run_budget = RunBudget(
            max_external_calls=_int_env(
                "CB_CAP_MAX_EXTERNAL_CALLS", 12, minimum=1, maximum=100
            ),
            max_model_tokens=_int_env(
                "CB_CAP_MAX_MODEL_TOKENS", 0, minimum=0, maximum=1_000_000
            ),
            max_model_cost_usd=_float_env(
                "CB_CAP_MAX_MODEL_COST_USD", 0.0, minimum=0.0, maximum=1000.0
            ),
        )
        persistence = PersistenceSettings.from_env()
        persistence.validate()
        checkpoint = CheckpointSettings.from_env()
        checkpoint.validate()
        gateway_url = _required_env("CB_CAP_EVIDENCE_GATEWAY_URL")
        EvidenceGatewayHttpClient(gateway_url)
        return cls(
            persistence=persistence,
            checkpoint=checkpoint,
            cognito=cognito,
            identity_policy=identity_policy,
            evidence_gateway_url=gateway_url,
            run_budget=run_budget,
        )


@dataclass(frozen=True)
class RuntimeApiDependencies:
    settings: RuntimeApiSettings
    token_verifier: CognitoAccessTokenVerifier
    gateway_client: EvidenceGatewayHttpClient


@lru_cache(maxsize=1)
def runtime_dependencies() -> RuntimeApiDependencies:
    settings = RuntimeApiSettings.from_env()
    return RuntimeApiDependencies(
        settings=settings,
        token_verifier=CognitoAccessTokenVerifier(settings.cognito),
        gateway_client=EvidenceGatewayHttpClient(settings.evidence_gateway_url),
    )


class CreateRunRequest(StrictModel):
    county_fips: str = Field(pattern=r"^\d{5}$")


class ReviewRunRequest(StrictModel):
    decision: ReviewDecision
    reason: str = Field(min_length=1, max_length=2000)


class RunResponse(StrictModel):
    run_id: str
    tenant_id: str
    geography_id: str
    county_fips: str
    status: str
    state_version: int | None = None
    interrupted: bool | None = None
    observation_id: str | None = None
    evidence_release_id: str | None = None
    evidence_release_hash: str | None = None


app = FastAPI(
    title="CB-CAP Runtime",
    version="1.0.0",
    docs_url=None,
    redoc_url=None,
    openapi_url=None,
)


@app.middleware("http")
async def security_response_headers(request: Request, call_next):
    request_id = f"request:{uuid4()}"
    response = await call_next(request)
    response.headers["Cache-Control"] = "no-store"
    response.headers["Pragma"] = "no-cache"
    response.headers["X-Content-Type-Options"] = "nosniff"
    response.headers["Referrer-Policy"] = "no-referrer"
    response.headers["X-Request-Id"] = request_id
    return response


def _access_token(request: Request) -> str:
    authorization = request.headers.get("authorization", "").strip()
    parts = authorization.split()
    if len(parts) != 2 or parts[0].lower() != "bearer" or not parts[1].strip():
        raise HTTPException(
            status_code=401,
            detail="authentication_required",
            headers={"WWW-Authenticate": "Bearer"},
        )
    return parts[1].strip()


def _run_response(
    run: CountyRunState,
    *,
    state_version: int | None = None,
    interrupted: bool | None = None,
    observation_id: str | None = None,
    evidence_release_id: str | None = None,
    evidence_release_hash: str | None = None,
) -> RunResponse:
    county_fips = run.county.county_fips
    if run.tenant_id is None or county_fips is None:
        raise RuntimeError("canonical tenant county run is incomplete")
    return RunResponse(
        run_id=run.run_id,
        tenant_id=run.tenant_id,
        geography_id=run.county.id,
        county_fips=county_fips,
        status=run.status.value,
        state_version=state_version,
        interrupted=interrupted,
        observation_id=observation_id,
        evidence_release_id=evidence_release_id,
        evidence_release_hash=evidence_release_hash,
    )


def _safe_http_error(exc: Exception) -> HTTPException:
    if isinstance(exc, CognitoAuthenticationError):
        return HTTPException(
            status_code=401,
            detail="authentication_failed",
            headers={"WWW-Authenticate": "Bearer"},
        )
    if isinstance(exc, PermissionError):
        return HTTPException(status_code=403, detail="not_authorized")
    if isinstance(exc, LookupError):
        return HTTPException(status_code=404, detail="run_not_found")
    if isinstance(exc, ValueError):
        return HTTPException(status_code=422, detail="invalid_request")
    return HTTPException(status_code=503, detail="runtime_unavailable")


@app.exception_handler(CognitoAuthenticationError)
async def cognito_authentication_error_handler(request: Request, exc: CognitoAuthenticationError):
    error = _safe_http_error(exc)
    return JSONResponse(
        status_code=error.status_code,
        content={"detail": error.detail},
        headers=error.headers,
    )


@app.get("/healthz")
def healthz():
    return {"status": "ok"}


@app.get("/readyz")
def readyz():
    dependencies = runtime_dependencies()
    try:
        with postgres_connection(dependencies.settings.persistence) as connection:
            with connection.cursor() as cursor:
                cursor.execute("SELECT 1")
                row = cursor.fetchone()
        if row != (1,):
            raise RuntimeError("database readiness probe returned an unexpected value")
    except Exception as exc:
        raise HTTPException(status_code=503, detail="not_ready") from exc
    return {"status": "ready"}


@app.post("/v1/tenants/{tenant_id}/runs", response_model=RunResponse, status_code=201)
def create_run(tenant_id: str, payload: CreateRunRequest, request: Request):
    dependencies = runtime_dependencies()
    token = _access_token(request)
    try:
        with postgres_connection(
            dependencies.settings.persistence,
            tenant_id=tenant_id,
        ) as connection:
            created = create_server_owned_run(
                connection,
                access_token=token,
                tenant_id=tenant_id,
                county_fips=payload.county_fips,
                token_verifier=dependencies.token_verifier,
                identity_policy=dependencies.settings.identity_policy,
                gateway_client=dependencies.gateway_client,
            )
        return _run_response(
            created.run,
            state_version=created.state_version.version_no,
            evidence_release_id=created.evidence_release_id,
            evidence_release_hash=created.evidence_release_hash,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _safe_http_error(exc) from exc


@app.get("/v1/tenants/{tenant_id}/runs/{run_id}", response_model=RunResponse)
def get_run(tenant_id: str, run_id: str, request: Request):
    dependencies = runtime_dependencies()
    token = _access_token(request)
    try:
        with postgres_connection(
            dependencies.settings.persistence,
            tenant_id=tenant_id,
        ) as connection:
            authorized = authorize_server_owned_run(
                connection,
                access_token=token,
                tenant_id=tenant_id,
                run_id=run_id,
                token_verifier=dependencies.token_verifier,
                identity_policy=dependencies.settings.identity_policy,
            )
        return _run_response(authorized.run)
    except HTTPException:
        raise
    except Exception as exc:
        raise _safe_http_error(exc) from exc


@app.post("/v1/tenants/{tenant_id}/runs/{run_id}/execute", response_model=RunResponse)
def execute_run(tenant_id: str, run_id: str, request: Request):
    dependencies = runtime_dependencies()
    token = _access_token(request)
    try:
        with postgres_checkpointer(dependencies.settings.checkpoint) as checkpointer:
            graph = build_county_planning_graph(checkpointer=checkpointer)
            with postgres_connection(
                dependencies.settings.persistence,
                tenant_id=tenant_id,
            ) as connection:
                authorized = authorize_server_owned_run(
                    connection,
                    access_token=token,
                    tenant_id=tenant_id,
                    run_id=run_id,
                    token_verifier=dependencies.token_verifier,
                    identity_policy=dependencies.settings.identity_policy,
                )
                execution = execute_county_run(
                    authorized.run,
                    dependencies.settings.run_budget.model_copy(deep=True),
                    dependencies.gateway_client,
                    graph,
                    connection,
                    actor=authorized.actor,
                )
                final_run = CountyRunState.model_validate(execution.graph_state["county_run"])
                state_version = append_county_run_state(
                    connection,
                    final_run,
                    actor=authorized.actor,
                )
        return _run_response(
            final_run,
            state_version=state_version.version_no,
            interrupted=execution.interrupted,
            observation_id=execution.observation.id,
            evidence_release_id=execution.observation.evidence_release_id,
            evidence_release_hash=execution.observation.evidence_release_hash,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _safe_http_error(exc) from exc


@app.post("/v1/tenants/{tenant_id}/runs/{run_id}/review", response_model=RunResponse)
def review_run(
    tenant_id: str,
    run_id: str,
    payload: ReviewRunRequest,
    request: Request,
):
    dependencies = runtime_dependencies()
    token = _access_token(request)
    try:
        with postgres_checkpointer(dependencies.settings.checkpoint) as checkpointer:
            graph = build_county_planning_graph(checkpointer=checkpointer)
            with postgres_connection(
                dependencies.settings.persistence,
                tenant_id=tenant_id,
            ) as connection:
                authorized = authorize_server_owned_run(
                    connection,
                    access_token=token,
                    tenant_id=tenant_id,
                    run_id=run_id,
                    token_verifier=dependencies.token_verifier,
                    identity_policy=dependencies.settings.identity_policy,
                )
                execution = resume_county_run_review(
                    run_id,
                    graph,
                    connection,
                    actor=authorized.actor,
                    decision=payload.decision,
                    reason=payload.reason.strip(),
                )
                final_run = CountyRunState.model_validate(execution.graph_state["county_run"])
                state_version = append_county_run_state(
                    connection,
                    final_run,
                    actor=authorized.actor,
                )
        return _run_response(
            final_run,
            state_version=state_version.version_no,
            interrupted=execution.interrupted,
            observation_id=execution.observation.id,
        )
    except HTTPException:
        raise
    except Exception as exc:
        raise _safe_http_error(exc) from exc

from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from pydantic import Field

from .authorization import AuthorizedActor, RuntimeRole, require_actor_capability
from .identity_adapter import ResolvedWorkspaceMembership, VerifiedExternalPrincipal
from .models import CountyRunState, StrictModel
from .persistence import ConnectionLike


class RuntimeRunIdentity(StrictModel):
    run_id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    county_fips: str = Field(pattern=r"^\d{5}$")
    created_by: str = Field(min_length=1)
    created_at: datetime


class RuntimeStateVersion(StrictModel):
    id: str = Field(pattern=r"^county-run-state:sha256:[0-9a-f]{64}$")
    tenant_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    version_no: int = Field(gt=0)
    state_hash: str = Field(pattern=r"^sha256:[0-9a-f]{64}$")
    status: str = Field(min_length=1)
    recorded_by: str = Field(min_length=1)
    recorded_at: datetime


def verified_principal_key(principal: VerifiedExternalPrincipal) -> str:
    """Return the same opaque principal key used by the authorization adapter."""

    digest = hashlib.sha256(
        f"{principal.issuer}\x00{principal.subject}".encode("utf-8")
    ).hexdigest()
    return f"principal:sha256:{digest}"


def county_run_state_hash(run: CountyRunState) -> str:
    serialized = json.dumps(
        run.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(serialized).hexdigest()


def _json_array(value: Any) -> list[str]:
    if isinstance(value, str):
        value = json.loads(value)
    if not isinstance(value, list) or any(not isinstance(item, str) for item in value):
        raise RuntimeError("workspace membership geography scope is invalid")
    if len(set(value)) != len(value) or any(not item.strip() for item in value):
        raise RuntimeError("workspace membership geography scope is invalid")
    return value


def load_run_identity(
    connection: ConnectionLike,
    *,
    tenant_id: str,
    run_id: str,
) -> RuntimeRunIdentity:
    """Load only immutable run scope before actor projection.

    The connection must already be tenant-scoped by RLS. This function does not
    expose canonical state and is intended only to bind a verified principal to
    the run's server-owned county scope.
    """

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT run_id, tenant_id, geography_id, county_fips, created_by, created_at
              FROM cbcap.county_run_identity
             WHERE tenant_id=%s AND run_id=%s
             LIMIT 1
            """,
            (tenant_id, run_id),
        )
        row = cursor.fetchone()
    if row is None:
        raise LookupError("county run is unavailable in the active tenant scope")
    identity = RuntimeRunIdentity(
        run_id=row[0],
        tenant_id=row[1],
        geography_id=row[2],
        county_fips=row[3],
        created_by=row[4],
        created_at=row[5],
    )
    if identity.tenant_id != tenant_id or identity.run_id != run_id:
        raise RuntimeError("county run identity crossed the requested tenant or run boundary")
    return identity


def resolve_workspace_membership(
    connection: ConnectionLike,
    principal: VerifiedExternalPrincipal,
    *,
    tenant_id: str,
    required_geography_id: str,
    run_id: str,
    as_of: datetime | None = None,
) -> ResolvedWorkspaceMembership:
    """Resolve the latest server-side membership event for one verified principal."""

    now = as_of or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("membership resolution time must be timezone-aware")
    principal_key = verified_principal_key(principal)

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT decision, role, geography_ids, membership_version, recorded_at, expires_at
              FROM cbcap.workspace_membership_event
             WHERE tenant_id=%s AND principal_key=%s
             ORDER BY recorded_at DESC
             LIMIT 2
            """,
            (tenant_id, principal_key),
        )
        rows = list(cursor.fetchall())

    if not rows:
        raise PermissionError("verified principal has no workspace membership in this tenant")
    if len(rows) > 1 and rows[0][4] == rows[1][4]:
        raise RuntimeError("workspace membership history has an ambiguous latest timestamp")

    decision, role, geography_ids_raw, membership_version, recorded_at, expires_at = rows[0]
    if decision != "granted":
        raise PermissionError("workspace membership is revoked")
    if expires_at is not None and now >= expires_at:
        raise PermissionError("workspace membership has expired")
    geography_ids = _json_array(geography_ids_raw)
    if required_geography_id not in geography_ids:
        raise PermissionError("workspace membership does not authorize this county")

    return ResolvedWorkspaceMembership(
        principal_subject=principal.subject,
        principal_issuer=principal.issuer,
        tenant_id=tenant_id,
        role=role,
        geography_ids=geography_ids,
        run_ids=[run_id],
        membership_version=membership_version,
        resolved_at=now,
    )


def load_canonical_county_run(
    connection: ConnectionLike,
    *,
    actor: AuthorizedActor,
    identity: RuntimeRunIdentity,
) -> CountyRunState:
    if actor.tenant_id != identity.tenant_id:
        raise ValueError("county run tenant does not match authenticated actor tenant")
    require_actor_capability(
        actor,
        "read_workspace",
        geography_id=identity.geography_id,
        run_id=identity.run_id,
    )

    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT state_json, state_hash
              FROM cbcap.county_run_state_version
             WHERE tenant_id=%s AND run_id=%s
             ORDER BY version_no DESC
             LIMIT 1
            """,
            (identity.tenant_id, identity.run_id),
        )
        row = cursor.fetchone()
    if row is None:
        raise LookupError("county run has no canonical state version")

    payload = row[0]
    if isinstance(payload, str):
        payload = json.loads(payload)
    run = CountyRunState.model_validate(payload)
    if run.tenant_id != identity.tenant_id or run.run_id != identity.run_id:
        raise RuntimeError("canonical county run state crossed its immutable identity boundary")
    if run.county.id != identity.geography_id or run.county.county_fips != identity.county_fips:
        raise RuntimeError("canonical county run state changed immutable county identity")
    if county_run_state_hash(run) != row[1]:
        raise RuntimeError("canonical county run state hash mismatch")
    return run


def persist_county_run_identity(
    connection: ConnectionLike,
    run: CountyRunState,
    *,
    actor: AuthorizedActor,
) -> RuntimeRunIdentity:
    if run.tenant_id is None or actor.tenant_id != run.tenant_id:
        raise ValueError("county run identity requires the authenticated tenant")
    require_actor_capability(
        actor,
        "execute_county_run",
        geography_id=run.county.id,
        run_id=run.run_id,
    )
    county_fips = run.county.county_fips
    if county_fips is None:
        raise ValueError("county run identity requires county FIPS")
    created_at = datetime.now(timezone.utc)
    identity = RuntimeRunIdentity(
        run_id=run.run_id,
        tenant_id=run.tenant_id,
        geography_id=run.county.id,
        county_fips=county_fips,
        created_by=actor.actor_id,
        created_at=created_at,
    )
    with connection.cursor() as cursor:
        cursor.execute(
            """
            INSERT INTO cbcap.county_run_identity (
              run_id, tenant_id, geography_id, county_fips, created_by, created_at
            ) VALUES (%s,%s,%s,%s,%s,%s)
            ON CONFLICT (run_id) DO NOTHING
            """,
            (
                identity.run_id,
                identity.tenant_id,
                identity.geography_id,
                identity.county_fips,
                identity.created_by,
                identity.created_at,
            ),
        )
        cursor.execute(
            """
            SELECT tenant_id, geography_id, county_fips
              FROM cbcap.county_run_identity
             WHERE run_id=%s
            """,
            (identity.run_id,),
        )
        existing = cursor.fetchone()
    if existing is None or tuple(existing) != (
        identity.tenant_id,
        identity.geography_id,
        identity.county_fips,
    ):
        raise RuntimeError("existing county run identity conflicts with requested immutable scope")
    return identity


def append_county_run_state(
    connection: ConnectionLike,
    run: CountyRunState,
    *,
    actor: AuthorizedActor,
) -> RuntimeStateVersion:
    if run.tenant_id is None or actor.tenant_id != run.tenant_id:
        raise ValueError("county run state requires the authenticated tenant")
    require_actor_capability(
        actor,
        "execute_county_run",
        geography_id=run.county.id,
        run_id=run.run_id,
    )

    state_hash = county_run_state_hash(run)
    state_id = "county-run-state:sha256:" + state_hash.removeprefix("sha256:")
    recorded_at = datetime.now(timezone.utc)
    with connection.cursor() as cursor:
        cursor.execute(
            """
            SELECT tenant_id, geography_id, county_fips
              FROM cbcap.county_run_identity
             WHERE run_id=%s
            """,
            (run.run_id,),
        )
        identity = cursor.fetchone()
        if identity is None:
            raise LookupError("county run identity must exist before state can be recorded")
        if tuple(identity) != (run.tenant_id, run.county.id, run.county.county_fips):
            raise RuntimeError("county run state conflicts with immutable run identity")

        cursor.execute(
            """
            SELECT version_no, state_hash
              FROM cbcap.county_run_state_version
             WHERE tenant_id=%s AND run_id=%s
             ORDER BY version_no DESC
             LIMIT 1
            """,
            (run.tenant_id, run.run_id),
        )
        latest = cursor.fetchone()
        if latest is not None and latest[1] == state_hash:
            return RuntimeStateVersion(
                id=state_id,
                tenant_id=run.tenant_id,
                run_id=run.run_id,
                version_no=int(latest[0]),
                state_hash=state_hash,
                status=run.status.value if hasattr(run.status, "value") else str(run.status),
                recorded_by=actor.actor_id,
                recorded_at=recorded_at,
            )
        next_version = 1 if latest is None else int(latest[0]) + 1
        status = run.status.value if hasattr(run.status, "value") else str(run.status)
        cursor.execute(
            """
            INSERT INTO cbcap.county_run_state_version (
              id, tenant_id, run_id, version_no, state_hash, state_json,
              status, recorded_by, recorded_at
            ) VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s)
            """,
            (
                state_id,
                run.tenant_id,
                run.run_id,
                next_version,
                state_hash,
                json.dumps(run.model_dump(mode="json"), sort_keys=True, separators=(",", ":")),
                status,
                actor.actor_id,
                recorded_at,
            ),
        )
    return RuntimeStateVersion(
        id=state_id,
        tenant_id=run.tenant_id,
        run_id=run.run_id,
        version_no=next_version,
        state_hash=state_hash,
        status=status,
        recorded_by=actor.actor_id,
        recorded_at=recorded_at,
    )

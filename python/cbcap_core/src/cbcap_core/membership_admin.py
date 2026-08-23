from __future__ import annotations

import hashlib
import json
import os
import re
from dataclasses import dataclass
from datetime import datetime, timezone
from urllib.parse import quote

import psycopg

_ALLOWED_ROLES = frozenset({"read_only", "analyst", "planner", "reviewer", "admin"})
_ALLOWED_DECISIONS = frozenset({"granted", "revoked"})


def _required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required")
    return value


def _admin_database_url() -> str:
    host = _required_env("CB_CAP_DATABASE_HOST")
    database = _required_env("CB_CAP_DATABASE_NAME")
    username = _required_env("CB_CAP_MIGRATION_DATABASE_USERNAME")
    password = _required_env("CB_CAP_MIGRATION_DATABASE_PASSWORD")
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


def _principal_key(*, issuer: str, subject: str) -> str:
    issuer = issuer.strip()
    subject = subject.strip()
    if not issuer.startswith("https://") or not subject:
        raise ValueError("verified Cognito issuer and subject are required")
    digest = hashlib.sha256(f"{issuer}\x00{subject}".encode("utf-8")).hexdigest()
    return f"principal:sha256:{digest}"


def _geography_ids(raw: str, *, decision: str) -> list[str]:
    values = [item.strip() for item in raw.split(",") if item.strip()]
    if len(values) != len(set(values)):
        raise ValueError("membership geography IDs must be unique")
    if any(not re.fullmatch(r"county:\d{5}", item) for item in values):
        raise ValueError("membership geography IDs must be canonical county IDs")
    if decision == "granted" and not values:
        raise ValueError("granted membership requires at least one county")
    return values


def _optional_expiry(raw: str) -> datetime | None:
    raw = raw.strip()
    if not raw:
        return None
    value = datetime.fromisoformat(raw.replace("Z", "+00:00"))
    if value.tzinfo is None or value.utcoffset() is None:
        raise ValueError("membership expiry must be timezone-aware")
    return value.astimezone(timezone.utc)


@dataclass(frozen=True)
class MembershipAdminRequest:
    tenant_id: str
    principal_key: str
    decision: str
    role: str
    geography_ids: tuple[str, ...]
    membership_version: str
    recorded_by: str
    expires_at: datetime | None

    @classmethod
    def from_env(cls) -> "MembershipAdminRequest":
        decision = _required_env("CB_CAP_MEMBERSHIP_DECISION").lower()
        if decision not in _ALLOWED_DECISIONS:
            raise ValueError("CB_CAP_MEMBERSHIP_DECISION must be granted or revoked")
        role = _required_env("CB_CAP_MEMBERSHIP_ROLE").lower()
        if role not in _ALLOWED_ROLES:
            raise ValueError("CB_CAP_MEMBERSHIP_ROLE is invalid")
        tenant_id = _required_env("CB_CAP_MEMBERSHIP_TENANT_ID")
        if not re.fullmatch(r"tenant:[A-Za-z0-9][A-Za-z0-9:._-]{1,127}", tenant_id):
            raise ValueError("CB_CAP_MEMBERSHIP_TENANT_ID is invalid")
        version = _required_env("CB_CAP_MEMBERSHIP_VERSION")
        if not re.fullmatch(r"[A-Za-z0-9][A-Za-z0-9:._-]{0,127}", version):
            raise ValueError("CB_CAP_MEMBERSHIP_VERSION is invalid")
        recorded_by = _required_env("CB_CAP_MEMBERSHIP_RECORDED_BY")
        if len(recorded_by) > 200:
            raise ValueError("CB_CAP_MEMBERSHIP_RECORDED_BY is too long")
        principal_key = _principal_key(
            issuer=_required_env("CB_CAP_MEMBERSHIP_PRINCIPAL_ISSUER"),
            subject=_required_env("CB_CAP_MEMBERSHIP_PRINCIPAL_SUBJECT"),
        )
        geographies = _geography_ids(
            os.getenv("CB_CAP_MEMBERSHIP_GEOGRAPHY_IDS", ""),
            decision=decision,
        )
        return cls(
            tenant_id=tenant_id,
            principal_key=principal_key,
            decision=decision,
            role=role,
            geography_ids=tuple(geographies),
            membership_version=version,
            recorded_by=recorded_by,
            expires_at=_optional_expiry(os.getenv("CB_CAP_MEMBERSHIP_EXPIRES_AT", "")),
        )


def _event_id(request: MembershipAdminRequest) -> str:
    identity = {
        "tenant_id": request.tenant_id,
        "principal_key": request.principal_key,
        "membership_version": request.membership_version,
        "decision": request.decision,
    }
    digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"workspace-membership:sha256:{digest}"


def record_membership_event(
    connection: psycopg.Connection,
    request: MembershipAdminRequest,
    *,
    recorded_at: datetime | None = None,
) -> str:
    now = recorded_at or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("membership recorded_at must be timezone-aware")
    now = now.astimezone(timezone.utc)
    if request.expires_at is not None and request.expires_at <= now:
        raise ValueError("membership expiry must be in the future")

    event_id = _event_id(request)
    with connection.transaction():
        connection.execute("SELECT set_config('app.tenant_id', %s, true)", (request.tenant_id,))
        existing = connection.execute(
            """
            SELECT id, decision, role, geography_ids, recorded_by, expires_at
              FROM cbcap.workspace_membership_event
             WHERE tenant_id=%s AND principal_key=%s AND membership_version=%s
            """,
            (request.tenant_id, request.principal_key, request.membership_version),
        ).fetchone()
        expected = (
            event_id,
            request.decision,
            request.role,
            list(request.geography_ids),
            request.recorded_by,
            request.expires_at,
        )
        if existing is not None:
            geography_value = existing[3]
            if isinstance(geography_value, str):
                geography_value = json.loads(geography_value)
            durable = (existing[0], existing[1], existing[2], geography_value, existing[4], existing[5])
            if durable != expected:
                raise RuntimeError("membership version already exists with different immutable content")
            return event_id

        connection.execute(
            """
            INSERT INTO cbcap.workspace_membership_event (
              id, tenant_id, principal_key, decision, role, geography_ids,
              membership_version, recorded_by, recorded_at, expires_at
            ) VALUES (%s,%s,%s,%s,%s,%s::jsonb,%s,%s,%s,%s)
            """,
            (
                event_id,
                request.tenant_id,
                request.principal_key,
                request.decision,
                request.role,
                json.dumps(list(request.geography_ids)),
                request.membership_version,
                request.recorded_by,
                now,
                request.expires_at,
            ),
        )
    return event_id


def main() -> None:
    request = MembershipAdminRequest.from_env()
    with psycopg.connect(_admin_database_url(), autocommit=True) as connection:
        event_id = record_membership_event(connection, request)
    print(event_id)


if __name__ == "__main__":
    main()

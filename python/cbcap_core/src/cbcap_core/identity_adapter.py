from __future__ import annotations

import hashlib
import json
from datetime import datetime, timedelta, timezone
from typing import Literal

from pydantic import Field, model_validator

from .authorization import (
    ROLE_CAPABILITIES,
    AuthorizationGrant,
    AuthorizedActor,
    RuntimeRole,
)
from .models import StrictModel

IdentityVerificationMethod = Literal[
    "oidc_jwt_verified",
    "server_session_verified",
]


class VerifiedExternalPrincipal(StrictModel):
    """Identity facts produced only after credential or session verification.

    CB-CAP deliberately does not parse or trust browser-supplied JWT claims in
    the core package. A deployment adapter verifies the IdP signature/session
    first, then passes the bounded identity facts represented here.
    """

    subject: str = Field(min_length=1)
    issuer: str = Field(min_length=1)
    session_id: str = Field(min_length=1)
    verification_method: IdentityVerificationMethod
    authenticated_at: datetime
    expires_at: datetime

    @model_validator(mode="after")
    def validate_identity_window(self) -> "VerifiedExternalPrincipal":
        if self.authenticated_at.tzinfo is None or self.authenticated_at.utcoffset() is None:
            raise ValueError("identity authenticated_at must be timezone-aware")
        if self.expires_at.tzinfo is None or self.expires_at.utcoffset() is None:
            raise ValueError("identity expires_at must be timezone-aware")
        if self.expires_at <= self.authenticated_at:
            raise ValueError("identity expires_at must be later than authenticated_at")
        return self


class ResolvedWorkspaceMembership(StrictModel):
    """Server-resolved CB-CAP membership, never a role supplied by the UI."""

    principal_subject: str = Field(min_length=1)
    principal_issuer: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    role: RuntimeRole
    geography_ids: list[str] = Field(default_factory=list)
    run_ids: list[str] = Field(default_factory=list)
    membership_version: str = Field(min_length=1)
    resolved_at: datetime

    @model_validator(mode="after")
    def validate_membership(self) -> "ResolvedWorkspaceMembership":
        if self.resolved_at.tzinfo is None or self.resolved_at.utcoffset() is None:
            raise ValueError("membership resolved_at must be timezone-aware")
        if len(set(self.geography_ids)) != len(self.geography_ids):
            raise ValueError("membership geography IDs must be unique")
        if len(set(self.run_ids)) != len(self.run_ids):
            raise ValueError("membership run IDs must be unique")
        if any(not item.strip() for item in self.geography_ids):
            raise ValueError("membership geography IDs cannot be blank")
        if any(not item.strip() for item in self.run_ids):
            raise ValueError("membership run IDs cannot be blank")
        return self


class IdentityProjectionPolicy(StrictModel):
    trusted_issuers: list[str] = Field(min_length=1)
    grant_ttl_seconds: int = Field(default=900, ge=60, le=3600)
    max_auth_age_seconds: int = Field(default=43200, ge=60, le=86400)

    @model_validator(mode="after")
    def validate_policy(self) -> "IdentityProjectionPolicy":
        if len(set(self.trusted_issuers)) != len(self.trusted_issuers):
            raise ValueError("trusted identity issuers must be unique")
        if any(not item.strip() for item in self.trusted_issuers):
            raise ValueError("trusted identity issuers cannot be blank")
        return self


def _opaque_actor_id(principal: VerifiedExternalPrincipal) -> str:
    digest = hashlib.sha256(
        f"{principal.issuer}\x00{principal.subject}".encode("utf-8")
    ).hexdigest()
    return f"principal:sha256:{digest}"


def _grant_id(
    *,
    actor_id: str,
    membership: ResolvedWorkspaceMembership,
    principal: VerifiedExternalPrincipal,
    issued_at: datetime,
    expires_at: datetime,
) -> str:
    identity = {
        "actor_id": actor_id,
        "tenant_id": membership.tenant_id,
        "role": membership.role,
        "geography_ids": sorted(membership.geography_ids),
        "run_ids": sorted(membership.run_ids),
        "membership_version": membership.membership_version,
        "issuer": principal.issuer,
        "session_id": principal.session_id,
        "issued_at": issued_at.isoformat(),
        "expires_at": expires_at.isoformat(),
    }
    digest = hashlib.sha256(
        json.dumps(identity, sort_keys=True, separators=(",", ":")).encode("utf-8")
    ).hexdigest()
    return f"authorization:sha256:{digest}"


def project_verified_identity(
    principal: VerifiedExternalPrincipal,
    membership: ResolvedWorkspaceMembership,
    policy: IdentityProjectionPolicy,
    *,
    as_of: datetime | None = None,
) -> AuthorizedActor:
    """Project verified identity plus server membership into a bounded actor.

    Capabilities are derived exclusively from the server-resolved role. The
    adapter accepts no caller-provided capability list, tenant override, actor
    identifier or reviewer identity.
    """

    now = as_of or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("identity projection time must be timezone-aware")
    if principal.issuer not in policy.trusted_issuers:
        raise PermissionError("identity issuer is not trusted for CB-CAP")
    if principal.issuer != membership.principal_issuer:
        raise PermissionError("workspace membership issuer does not match verified identity")
    if principal.subject != membership.principal_subject:
        raise PermissionError("workspace membership subject does not match verified identity")
    if now < principal.authenticated_at:
        raise PermissionError("verified identity is not yet valid")
    if now >= principal.expires_at:
        raise PermissionError("verified identity has expired")
    if now - principal.authenticated_at > timedelta(seconds=policy.max_auth_age_seconds):
        raise PermissionError("verified identity is too old for a new runtime grant")
    if membership.resolved_at > now:
        raise PermissionError("workspace membership resolution time is in the future")

    actor_id = _opaque_actor_id(principal)
    expires_at = min(
        principal.expires_at,
        now + timedelta(seconds=policy.grant_ttl_seconds),
    )
    if expires_at <= now:
        raise PermissionError("verified identity cannot produce a current runtime grant")

    grant = AuthorizationGrant(
        grant_id=_grant_id(
            actor_id=actor_id,
            membership=membership,
            principal=principal,
            issued_at=now,
            expires_at=expires_at,
        ),
        actor_id=actor_id,
        tenant_id=membership.tenant_id,
        capabilities=sorted(ROLE_CAPABILITIES[membership.role]),
        geography_ids=sorted(membership.geography_ids),
        run_ids=sorted(membership.run_ids),
        issuer=principal.issuer,
        issued_at=now,
        expires_at=expires_at,
    )
    return AuthorizedActor(
        actor_id=actor_id,
        tenant_id=membership.tenant_id,
        role=membership.role,
        authorization=grant,
    )

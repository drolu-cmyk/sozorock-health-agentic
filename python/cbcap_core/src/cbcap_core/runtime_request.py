from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Callable, Protocol
from uuid import uuid4

from .authorization import AuthorizedActor
from .gateway_transport import EvidenceGatewayHttpClient
from .identity_adapter import (
    IdentityProjectionPolicy,
    ResolvedWorkspaceMembership,
    VerifiedExternalPrincipal,
    project_verified_identity,
)
from .models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus
from .persistence import ConnectionLike
from .runtime_registry import (
    RuntimeRunIdentity,
    RuntimeStateVersion,
    append_county_run_state,
    load_canonical_county_run,
    load_run_identity,
    persist_county_run_identity,
    resolve_workspace_membership,
)


class AccessTokenVerifier(Protocol):
    def verify(self, token: str) -> VerifiedExternalPrincipal: ...


@dataclass(frozen=True)
class AuthorizedServerRun:
    principal: VerifiedExternalPrincipal
    membership: ResolvedWorkspaceMembership
    actor: AuthorizedActor
    identity: RuntimeRunIdentity
    run: CountyRunState


@dataclass(frozen=True)
class CreatedServerRun(AuthorizedServerRun):
    state_version: RuntimeStateVersion
    evidence_release_id: str
    evidence_release_hash: str


def _validated_tenant(tenant_id: str) -> str:
    normalized = tenant_id.strip()
    if not normalized:
        raise ValueError("tenant_id is required")
    return normalized


def _validated_county_fips(county_fips: str) -> str:
    normalized = county_fips.strip()
    if len(normalized) != 5 or not normalized.isdigit():
        raise ValueError("county_fips must be five digits")
    return normalized


def _new_run_id(county_fips: str) -> str:
    return f"run:county:{county_fips}:{uuid4()}"


def _county_geography_id(county_fips: str) -> str:
    return f"county:{county_fips}"


def authorize_server_owned_run(
    connection: ConnectionLike,
    *,
    access_token: str,
    tenant_id: str,
    run_id: str,
    token_verifier: AccessTokenVerifier,
    identity_policy: IdentityProjectionPolicy,
) -> AuthorizedServerRun:
    """Resolve one runtime request without accepting canonical state from a client.

    The supplied connection must already be scoped by RLS to `tenant_id`.
    Authentication occurs before any run lookup. The browser may identify the
    tenant and run it wants to access, but neither becomes authorized until the
    verified principal has a current server-side membership for the immutable
    county identity of that exact run.
    """

    tenant_id = _validated_tenant(tenant_id)
    run_id = run_id.strip()
    if not run_id:
        raise ValueError("run_id is required")

    principal = token_verifier.verify(access_token)
    identity = load_run_identity(
        connection,
        tenant_id=tenant_id,
        run_id=run_id,
    )
    membership = resolve_workspace_membership(
        connection,
        principal,
        tenant_id=tenant_id,
        required_geography_id=identity.geography_id,
        run_id=run_id,
    )
    actor = project_verified_identity(
        principal,
        membership,
        identity_policy,
    )
    run = load_canonical_county_run(
        connection,
        actor=actor,
        identity=identity,
    )
    return AuthorizedServerRun(
        principal=principal,
        membership=membership,
        actor=actor,
        identity=identity,
        run=run,
    )


def create_server_owned_run(
    connection: ConnectionLike,
    *,
    access_token: str,
    tenant_id: str,
    county_fips: str,
    token_verifier: AccessTokenVerifier,
    identity_policy: IdentityProjectionPolicy,
    gateway_client: EvidenceGatewayHttpClient,
    run_id_factory: Callable[[str], str] = _new_run_id,
    requested_at: datetime | None = None,
) -> CreatedServerRun:
    """Create one canonical county run after identity and membership authorization.

    Only the county FIPS is accepted as selection input. Run ID, canonical county
    geography, run state, actor, role and capabilities are produced server side.
    Public evidence is fetched only after a verified principal has a current
    membership grant for the selected county.
    """

    tenant_id = _validated_tenant(tenant_id)
    county_fips = _validated_county_fips(county_fips)
    now = requested_at or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("requested_at must be timezone-aware")

    principal = token_verifier.verify(access_token)
    run_id = run_id_factory(county_fips).strip()
    if not run_id:
        raise RuntimeError("server run ID factory returned a blank identifier")

    expected_geography_id = _county_geography_id(county_fips)
    membership = resolve_workspace_membership(
        connection,
        principal,
        tenant_id=tenant_id,
        required_geography_id=expected_geography_id,
        run_id=run_id,
        as_of=now,
    )
    actor = project_verified_identity(
        principal,
        membership,
        identity_policy,
        as_of=now,
    )

    fetched = gateway_client.fetch_county(county_fips)
    if fetched.response is None or fetched.not_modified:
        raise RuntimeError("new county run requires a complete current Evidence Gateway response")
    county_candidates = [
        item
        for item in fetched.response.package.geographies
        if item.kind == GeographyKind.COUNTY and item.county_fips == county_fips
    ]
    if len(county_candidates) != 1:
        raise RuntimeError("Evidence Gateway did not return exactly one canonical county geography")
    county: GeographyRef = county_candidates[0]
    if county.id != expected_geography_id:
        raise RuntimeError("Evidence Gateway county identity does not match canonical county key")
    if county.review_status != ReviewStatus.VERIFIED:
        raise RuntimeError("new county run requires verified canonical county geography")

    run = CountyRunState(
        run_id=run_id,
        tenant_id=tenant_id,
        county=county,
        requested_at=now,
    )
    identity = persist_county_run_identity(connection, run, actor=actor)
    state_version = append_county_run_state(connection, run, actor=actor)

    return CreatedServerRun(
        principal=principal,
        membership=membership,
        actor=actor,
        identity=identity,
        run=run,
        state_version=state_version,
        evidence_release_id=fetched.response.manifest.release_id,
        evidence_release_hash=fetched.response.manifest.release_hash,
    )

from __future__ import annotations

from dataclasses import dataclass
from typing import Protocol

from .authorization import AuthorizedActor
from .identity_adapter import (
    IdentityProjectionPolicy,
    ResolvedWorkspaceMembership,
    VerifiedExternalPrincipal,
    project_verified_identity,
)
from .models import CountyRunState
from .persistence import ConnectionLike
from .runtime_registry import (
    RuntimeRunIdentity,
    load_canonical_county_run,
    load_run_identity,
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

    tenant_id = tenant_id.strip()
    run_id = run_id.strip()
    if not tenant_id or not run_id:
        raise ValueError("tenant_id and run_id are required")

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

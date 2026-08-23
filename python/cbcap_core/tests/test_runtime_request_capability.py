from datetime import datetime, timedelta, timezone

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.identity_adapter import IdentityProjectionPolicy, ResolvedWorkspaceMembership, VerifiedExternalPrincipal
from cbcap_core.runtime_request import create_server_owned_run

TENANT = "tenant:albany-planning"
COUNTY = "county:36001"
RUN = "run:county:36001:server-generated"
ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example123"
NOW = datetime(2026, 8, 23, 16, 0, tzinfo=timezone.utc)


class FakeVerifier:
    def verify(self, token):
        return VerifiedExternalPrincipal(
            subject="subject-123",
            issuer=ISSUER,
            session_id="session-123",
            verification_method="oidc_jwt_verified",
            authenticated_at=NOW - timedelta(minutes=5),
            expires_at=NOW + timedelta(hours=1),
        )


class FailingIfCalledGateway:
    def __init__(self):
        self.calls = []

    def fetch_county(self, county_fips, *, etag=None):
        self.calls.append((county_fips, etag))
        raise AssertionError("gateway must not be reached without execute_county_run")


def test_read_only_membership_cannot_reach_gateway_during_run_creation(monkeypatch):
    membership = ResolvedWorkspaceMembership(
        principal_subject="subject-123",
        principal_issuer=ISSUER,
        tenant_id=TENANT,
        role="read_only",
        geography_ids=[COUNTY],
        run_ids=[RUN],
        membership_version="membership:v1",
        resolved_at=NOW,
    )
    actor_id = "principal:sha256:" + "a" * 64
    read_only_actor = AuthorizedActor(
        actor_id=actor_id,
        tenant_id=TENANT,
        role="read_only",
        authorization=AuthorizationGrant(
            grant_id="authorization:sha256:" + "b" * 64,
            actor_id=actor_id,
            tenant_id=TENANT,
            capabilities=sorted(ROLE_CAPABILITIES["read_only"]),
            geography_ids=[COUNTY],
            run_ids=[RUN],
            issuer=ISSUER,
            issued_at=NOW,
            expires_at=NOW + timedelta(minutes=15),
        ),
    )
    gateway = FailingIfCalledGateway()

    monkeypatch.setattr(
        "cbcap_core.runtime_request.resolve_workspace_membership",
        lambda *args, **kwargs: membership,
    )
    monkeypatch.setattr(
        "cbcap_core.runtime_request.project_verified_identity",
        lambda *args, **kwargs: read_only_actor,
    )

    with pytest.raises(PermissionError, match="execute_county_run"):
        create_server_owned_run(
            object(),
            access_token="token",
            tenant_id=TENANT,
            county_fips="36001",
            token_verifier=FakeVerifier(),
            identity_policy=IdentityProjectionPolicy(trusted_issuers=[ISSUER]),
            gateway_client=gateway,
            run_id_factory=lambda _: RUN,
            requested_at=NOW,
        )

    assert gateway.calls == []

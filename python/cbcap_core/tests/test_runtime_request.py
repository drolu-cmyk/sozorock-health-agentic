from datetime import datetime, timedelta, timezone

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.identity_adapter import (
    IdentityProjectionPolicy,
    ResolvedWorkspaceMembership,
    VerifiedExternalPrincipal,
)
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus
from cbcap_core.runtime_registry import RuntimeRunIdentity
from cbcap_core.runtime_request import authorize_server_owned_run

TENANT = "tenant:albany-planning"
RUN = "run:runtime-request:36001"
COUNTY = "county:36001"
ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example123"
NOW = datetime(2026, 8, 23, 15, 30, tzinfo=timezone.utc)


class UnusedConnection:
    pass


class FakeVerifier:
    def __init__(self, *, fail=False):
        self.fail = fail
        self.tokens = []

    def verify(self, token):
        self.tokens.append(token)
        if self.fail:
            raise PermissionError("token rejected")
        return VerifiedExternalPrincipal(
            subject="subject-123",
            issuer=ISSUER,
            session_id="session-123",
            verification_method="oidc_jwt_verified",
            authenticated_at=NOW - timedelta(minutes=5),
            expires_at=NOW + timedelta(hours=1),
        )


def identity():
    return RuntimeRunIdentity(
        run_id=RUN,
        tenant_id=TENANT,
        geography_id=COUNTY,
        county_fips="36001",
        created_by="principal:creator",
        created_at=NOW - timedelta(days=1),
    )


def membership():
    return ResolvedWorkspaceMembership(
        principal_subject="subject-123",
        principal_issuer=ISSUER,
        tenant_id=TENANT,
        role="planner",
        geography_ids=[COUNTY],
        run_ids=[RUN],
        membership_version="membership:v1",
        resolved_at=NOW,
    )


def actor():
    actor_id = "principal:sha256:" + "a" * 64
    return AuthorizedActor(
        actor_id=actor_id,
        tenant_id=TENANT,
        role="planner",
        authorization=AuthorizationGrant(
            grant_id="authorization:sha256:" + "b" * 64,
            actor_id=actor_id,
            tenant_id=TENANT,
            capabilities=sorted(ROLE_CAPABILITIES["planner"]),
            geography_ids=[COUNTY],
            run_ids=[RUN],
            issuer=ISSUER,
            issued_at=NOW,
            expires_at=NOW + timedelta(minutes=15),
        ),
    )


def run():
    return CountyRunState(
        run_id=RUN,
        tenant_id=TENANT,
        county=GeographyRef(
            id=COUNTY,
            kind=GeographyKind.COUNTY,
            authority="census",
            authority_id="36001",
            name="Albany County",
            display_name="Albany County, New York",
            state_fips="36",
            county_fips="36001",
            vintage="2025",
            review_status=ReviewStatus.VERIFIED,
        ),
        requested_at=NOW,
    )


def policy():
    return IdentityProjectionPolicy(trusted_issuers=[ISSUER])


def test_request_verifies_token_before_any_run_or_membership_lookup(monkeypatch):
    verifier = FakeVerifier(fail=True)
    calls = []

    monkeypatch.setattr(
        "cbcap_core.runtime_request.load_run_identity",
        lambda *args, **kwargs: calls.append("run_identity"),
    )
    monkeypatch.setattr(
        "cbcap_core.runtime_request.resolve_workspace_membership",
        lambda *args, **kwargs: calls.append("membership"),
    )

    with pytest.raises(PermissionError, match="token rejected"):
        authorize_server_owned_run(
            UnusedConnection(),
            access_token="verified-or-rejected-token",
            tenant_id=TENANT,
            run_id=RUN,
            token_verifier=verifier,
            identity_policy=policy(),
        )

    assert verifier.tokens == ["verified-or-rejected-token"]
    assert calls == []


def test_request_uses_immutable_run_identity_to_scope_server_membership(monkeypatch):
    verifier = FakeVerifier()
    observed = {}

    monkeypatch.setattr(
        "cbcap_core.runtime_request.load_run_identity",
        lambda connection, *, tenant_id, run_id: (
            observed.update({"identity_tenant": tenant_id, "identity_run": run_id}) or identity()
        ),
    )

    def fake_membership(connection, principal, *, tenant_id, required_geography_id, run_id):
        observed.update(
            {
                "membership_tenant": tenant_id,
                "membership_geography": required_geography_id,
                "membership_run": run_id,
                "principal_subject": principal.subject,
            }
        )
        return membership()

    monkeypatch.setattr("cbcap_core.runtime_request.resolve_workspace_membership", fake_membership)
    monkeypatch.setattr(
        "cbcap_core.runtime_request.project_verified_identity",
        lambda principal, resolved_membership, projection_policy: actor(),
    )
    monkeypatch.setattr(
        "cbcap_core.runtime_request.load_canonical_county_run",
        lambda connection, *, actor, identity: run(),
    )

    authorized = authorize_server_owned_run(
        UnusedConnection(),
        access_token="token",
        tenant_id=TENANT,
        run_id=RUN,
        token_verifier=verifier,
        identity_policy=policy(),
    )

    assert observed == {
        "identity_tenant": TENANT,
        "identity_run": RUN,
        "membership_tenant": TENANT,
        "membership_geography": COUNTY,
        "membership_run": RUN,
        "principal_subject": "subject-123",
    }
    assert authorized.identity.geography_id == COUNTY
    assert authorized.membership.run_ids == [RUN]
    assert authorized.actor.authorization.run_ids == [RUN]
    assert authorized.run.run_id == RUN


def test_canonical_run_is_loaded_only_after_actor_projection(monkeypatch):
    verifier = FakeVerifier()
    order = []

    monkeypatch.setattr(
        "cbcap_core.runtime_request.load_run_identity",
        lambda *args, **kwargs: order.append("identity") or identity(),
    )
    monkeypatch.setattr(
        "cbcap_core.runtime_request.resolve_workspace_membership",
        lambda *args, **kwargs: order.append("membership") or membership(),
    )
    monkeypatch.setattr(
        "cbcap_core.runtime_request.project_verified_identity",
        lambda *args, **kwargs: order.append("actor") or actor(),
    )
    monkeypatch.setattr(
        "cbcap_core.runtime_request.load_canonical_county_run",
        lambda *args, **kwargs: order.append("canonical_run") or run(),
    )

    authorize_server_owned_run(
        UnusedConnection(),
        access_token="token",
        tenant_id=TENANT,
        run_id=RUN,
        token_verifier=verifier,
        identity_policy=policy(),
    )

    assert order == ["identity", "membership", "actor", "canonical_run"]


def test_blank_tenant_or_run_is_rejected_before_token_verification():
    verifier = FakeVerifier()
    for tenant_id, run_id in (("", RUN), (TENANT, ""), ("  ", RUN), (TENANT, "  ")):
        with pytest.raises(ValueError, match="tenant_id and run_id"):
            authorize_server_owned_run(
                UnusedConnection(),
                access_token="token",
                tenant_id=tenant_id,
                run_id=run_id,
                token_verifier=verifier,
                identity_policy=policy(),
            )
    assert verifier.tokens == []

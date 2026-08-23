from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.identity_adapter import (
    IdentityProjectionPolicy,
    ResolvedWorkspaceMembership,
    VerifiedExternalPrincipal,
)
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus
from cbcap_core.runtime_registry import RuntimeRunIdentity, RuntimeStateVersion
from cbcap_core.runtime_request import authorize_server_owned_run, create_server_owned_run

TENANT = "tenant:albany-planning"
RUN = "run:runtime-request:36001"
CREATED_RUN = "run:county:36001:server-generated"
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


class FakeGateway:
    def __init__(self, geography=None):
        self.calls = []
        self.geography = geography or county()

    def fetch_county(self, county_fips, *, etag=None):
        self.calls.append((county_fips, etag))
        response = SimpleNamespace(
            package=SimpleNamespace(geographies=[self.geography]),
            manifest=SimpleNamespace(
                release_id="release:public:2026-08-23",
                release_hash="sha256:" + "c" * 64,
            ),
        )
        return SimpleNamespace(response=response, not_modified=False)


def county(*, geography_id=COUNTY, review_status=ReviewStatus.VERIFIED):
    return GeographyRef(
        id=geography_id,
        kind=GeographyKind.COUNTY,
        authority="census",
        authority_id="36001",
        name="Albany County",
        display_name="Albany County, New York",
        state_fips="36",
        county_fips="36001",
        vintage="2025",
        review_status=review_status,
    )


def identity(*, run_id=RUN):
    return RuntimeRunIdentity(
        run_id=run_id,
        tenant_id=TENANT,
        geography_id=COUNTY,
        county_fips="36001",
        created_by="principal:creator",
        created_at=NOW - timedelta(days=1),
    )


def membership(*, run_id=RUN):
    return ResolvedWorkspaceMembership(
        principal_subject="subject-123",
        principal_issuer=ISSUER,
        tenant_id=TENANT,
        role="planner",
        geography_ids=[COUNTY],
        run_ids=[run_id],
        membership_version="membership:v1",
        resolved_at=NOW,
    )


def actor(*, run_id=RUN):
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
            run_ids=[run_id],
            issuer=ISSUER,
            issued_at=NOW,
            expires_at=NOW + timedelta(minutes=15),
        ),
    )


def run(*, run_id=RUN):
    return CountyRunState(
        run_id=run_id,
        tenant_id=TENANT,
        county=county(),
        requested_at=NOW,
    )


def state_version(*, run_id=CREATED_RUN):
    return RuntimeStateVersion(
        id="county-run-state:sha256:" + "d" * 64,
        tenant_id=TENANT,
        run_id=run_id,
        version_no=1,
        state_hash="sha256:" + "d" * 64,
        status="created",
        recorded_by="principal:sha256:" + "a" * 64,
        recorded_at=NOW,
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
    for tenant_id, run_id, message in (
        ("", RUN, "tenant_id"),
        (TENANT, "", "run_id"),
        ("  ", RUN, "tenant_id"),
        (TENANT, "  ", "run_id"),
    ):
        with pytest.raises(ValueError, match=message):
            authorize_server_owned_run(
                UnusedConnection(),
                access_token="token",
                tenant_id=tenant_id,
                run_id=run_id,
                token_verifier=verifier,
                identity_policy=policy(),
            )
    assert verifier.tokens == []


def test_new_run_checks_verified_membership_before_public_gateway_access(monkeypatch):
    verifier = FakeVerifier()
    gateway = FakeGateway()
    order = []

    def deny_membership(*args, **kwargs):
        order.append("membership")
        raise PermissionError("not authorized for county")

    monkeypatch.setattr("cbcap_core.runtime_request.resolve_workspace_membership", deny_membership)

    with pytest.raises(PermissionError, match="not authorized for county"):
        create_server_owned_run(
            UnusedConnection(),
            access_token="token",
            tenant_id=TENANT,
            county_fips="36001",
            token_verifier=verifier,
            identity_policy=policy(),
            gateway_client=gateway,
            run_id_factory=lambda _: CREATED_RUN,
            requested_at=NOW,
        )

    assert verifier.tokens == ["token"]
    assert order == ["membership"]
    assert gateway.calls == []


def test_new_run_is_created_from_verified_gateway_geography_and_server_generated_id(monkeypatch):
    verifier = FakeVerifier()
    gateway = FakeGateway()
    order = []

    def resolved_membership(*args, **kwargs):
        order.append(("membership", kwargs["required_geography_id"], kwargs["run_id"]))
        return membership(run_id=CREATED_RUN)

    def projected_actor(*args, **kwargs):
        order.append(("actor", kwargs.get("as_of")))
        return actor(run_id=CREATED_RUN)

    def persisted_identity(connection, canonical_run, *, actor):
        order.append(("identity", canonical_run.run_id, canonical_run.county.id))
        return identity(run_id=CREATED_RUN)

    def persisted_state(connection, canonical_run, *, actor):
        order.append(("state", canonical_run.run_id, canonical_run.status.value))
        return state_version()

    monkeypatch.setattr("cbcap_core.runtime_request.resolve_workspace_membership", resolved_membership)
    monkeypatch.setattr("cbcap_core.runtime_request.project_verified_identity", projected_actor)
    monkeypatch.setattr("cbcap_core.runtime_request.persist_county_run_identity", persisted_identity)
    monkeypatch.setattr("cbcap_core.runtime_request.append_county_run_state", persisted_state)

    created = create_server_owned_run(
        UnusedConnection(),
        access_token="token",
        tenant_id=TENANT,
        county_fips="36001",
        token_verifier=verifier,
        identity_policy=policy(),
        gateway_client=gateway,
        run_id_factory=lambda fips: CREATED_RUN,
        requested_at=NOW,
    )

    assert gateway.calls == [("36001", None)]
    assert order[0] == ("membership", COUNTY, CREATED_RUN)
    assert order[1] == ("actor", NOW)
    assert order[2] == ("identity", CREATED_RUN, COUNTY)
    assert order[3] == ("state", CREATED_RUN, "created")
    assert created.run.run_id == CREATED_RUN
    assert created.run.county.id == COUNTY
    assert created.state_version.version_no == 1
    assert created.evidence_release_id == "release:public:2026-08-23"


def test_new_run_rejects_gateway_geography_that_breaks_canonical_county_identity(monkeypatch):
    verifier = FakeVerifier()
    gateway = FakeGateway(geography=county(geography_id="county:wrong"))
    monkeypatch.setattr(
        "cbcap_core.runtime_request.resolve_workspace_membership",
        lambda *args, **kwargs: membership(run_id=CREATED_RUN),
    )
    monkeypatch.setattr(
        "cbcap_core.runtime_request.project_verified_identity",
        lambda *args, **kwargs: actor(run_id=CREATED_RUN),
    )

    with pytest.raises(RuntimeError, match="canonical county key"):
        create_server_owned_run(
            UnusedConnection(),
            access_token="token",
            tenant_id=TENANT,
            county_fips="36001",
            token_verifier=verifier,
            identity_policy=policy(),
            gateway_client=gateway,
            run_id_factory=lambda _: CREATED_RUN,
            requested_at=NOW,
        )

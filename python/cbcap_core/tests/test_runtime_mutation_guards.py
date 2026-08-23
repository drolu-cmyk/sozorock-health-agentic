from datetime import datetime, timedelta, timezone

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.identity_adapter import (
    IdentityProjectionPolicy,
    ResolvedWorkspaceMembership,
    VerifiedExternalPrincipal,
)
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus, RunStatus
from cbcap_core.runtime_registry import RuntimeRunIdentity
from cbcap_core.runtime_request import (
    RunStateConflict,
    authorize_server_owned_run,
    require_run_operation_state,
)

TENANT = "tenant:albany-planning"
COUNTY = "county:36001"
RUN = "run:mutation-guard:36001"
ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example123"
NOW = datetime(2026, 8, 23, 17, 30, tzinfo=timezone.utc)


class UnusedConnection:
    pass


class OrderedVerifier:
    def __init__(self, order, *, fail=False):
        self.order = order
        self.fail = fail

    def verify(self, token):
        self.order.append("verify")
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


def geography():
    return GeographyRef(
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
    )


def county_run(status=RunStatus.CREATED):
    return CountyRunState(
        run_id=RUN,
        tenant_id=TENANT,
        county=geography(),
        requested_at=NOW,
        status=status,
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
            issued_at=NOW - timedelta(minutes=1),
            expires_at=NOW + timedelta(minutes=15),
        ),
    )


def policy():
    return IdentityProjectionPolicy(trusted_issuers=[ISSUER])


def test_mutation_lock_happens_after_token_verification_and_before_state_read(monkeypatch):
    order = []
    verifier = OrderedVerifier(order)

    monkeypatch.setattr(
        "cbcap_core.runtime_request.lock_county_run_identity",
        lambda *args, **kwargs: order.append("lock"),
    )
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
        lambda *args, **kwargs: order.append("canonical_state") or county_run(),
    )

    authorize_server_owned_run(
        UnusedConnection(),
        access_token="token",
        tenant_id=TENANT,
        run_id=RUN,
        token_verifier=verifier,
        identity_policy=policy(),
        lock_for_mutation=True,
    )

    assert order == ["verify", "lock", "identity", "membership", "actor", "canonical_state"]


def test_failed_authentication_never_reaches_mutation_lock(monkeypatch):
    order = []
    verifier = OrderedVerifier(order, fail=True)
    monkeypatch.setattr(
        "cbcap_core.runtime_request.lock_county_run_identity",
        lambda *args, **kwargs: order.append("lock"),
    )

    with pytest.raises(PermissionError, match="token rejected"):
        authorize_server_owned_run(
            UnusedConnection(),
            access_token="bad-token",
            tenant_id=TENANT,
            run_id=RUN,
            token_verifier=verifier,
            identity_policy=policy(),
            lock_for_mutation=True,
        )

    assert order == ["verify"]


def test_execute_only_accepts_created_state():
    require_run_operation_state(county_run(RunStatus.CREATED), "execute")
    for status in (
        RunStatus.RUNNING,
        RunStatus.WAITING_REVIEW,
        RunStatus.BLOCKED,
        RunStatus.COMPLETED,
        RunStatus.CANCELLED,
        RunStatus.FAILED,
    ):
        with pytest.raises(RunStateConflict, match="cannot execute"):
            require_run_operation_state(county_run(status), "execute")


def test_review_only_accepts_waiting_review_state():
    require_run_operation_state(county_run(RunStatus.WAITING_REVIEW), "review")
    for status in (
        RunStatus.CREATED,
        RunStatus.RUNNING,
        RunStatus.BLOCKED,
        RunStatus.COMPLETED,
        RunStatus.CANCELLED,
        RunStatus.FAILED,
    ):
        with pytest.raises(RunStateConflict, match="cannot review"):
            require_run_operation_state(county_run(status), "review")

from datetime import datetime, timedelta, timezone

import pytest

from cbcap_core.authorization import AuthorizationGrant, AuthorizedActor, ROLE_CAPABILITIES
from cbcap_core.identity_adapter import VerifiedExternalPrincipal
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus, RunStatus
from cbcap_core.runtime_registry import (
    append_county_run_state,
    county_run_state_hash,
    persist_county_run_identity,
    resolve_workspace_membership,
    verified_principal_key,
)

TENANT = "tenant:albany-planning"
COUNTY = "county:36001"
RUN = "run:registry:36001"
NOW = datetime(2026, 8, 23, 15, 0, tzinfo=timezone.utc)
OLD_TIME = NOW - timedelta(days=3)


def principal():
    return VerifiedExternalPrincipal(
        subject="subject-123",
        issuer="https://identity.example.test/verified",
        session_id="session-1",
        verification_method="oidc_jwt_verified",
        authenticated_at=NOW - timedelta(minutes=5),
        expires_at=NOW + timedelta(hours=1),
    )


def actor(*, role="planner"):
    actor_id = "principal:planner"
    return AuthorizedActor(
        actor_id=actor_id,
        tenant_id=TENANT,
        role=role,
        authorization=AuthorizationGrant(
            grant_id="grant:registry",
            actor_id=actor_id,
            tenant_id=TENANT,
            capabilities=sorted(ROLE_CAPABILITIES[role]),
            geography_ids=[COUNTY],
            run_ids=[RUN],
            issuer="test-identity-verifier",
            issued_at=NOW - timedelta(minutes=5),
            expires_at=NOW + timedelta(hours=1),
        ),
    )


def run(*, status=RunStatus.CREATED):
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
        status=status,
    )


class ScriptedCursor:
    def __init__(self, connection):
        self.connection = connection
        self.response = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.connection.executions.append((normalized, params))
        if not self.connection.responses:
            raise AssertionError(f"unexpected SQL execution: {normalized}")
        self.response = self.connection.responses.pop(0)

    def fetchone(self):
        return self.response

    def fetchall(self):
        return self.response


class ScriptedConnection:
    def __init__(self, responses):
        self.responses = list(responses)
        self.executions = []

    def cursor(self):
        return ScriptedCursor(self)

    def commit(self):
        pass

    def rollback(self):
        pass


def test_verified_principal_key_is_opaque_and_stable():
    first = verified_principal_key(principal())
    second = verified_principal_key(principal())
    assert first == second
    assert first.startswith("principal:sha256:")
    assert principal().subject not in first


def test_membership_resolution_uses_server_event_and_scopes_grant_to_current_run():
    connection = ScriptedConnection(
        [
            [
                (
                    "granted",
                    "planner",
                    [COUNTY],
                    "membership:v7",
                    OLD_TIME,
                    NOW + timedelta(days=30),
                )
            ]
        ]
    )
    membership = resolve_workspace_membership(
        connection,
        principal(),
        tenant_id=TENANT,
        required_geography_id=COUNTY,
        run_id=RUN,
        as_of=NOW,
    )
    assert membership.tenant_id == TENANT
    assert membership.role == "planner"
    assert membership.geography_ids == [COUNTY]
    assert membership.run_ids == [RUN]
    assert membership.membership_version == "membership:v7"
    assert verified_principal_key(principal()) in connection.executions[0][1]


def test_future_or_revoked_membership_event_fails_closed():
    future = ScriptedConnection(
        [[("granted", "planner", [COUNTY], "membership:future", NOW + timedelta(seconds=1), None)]]
    )
    with pytest.raises(RuntimeError, match="future"):
        resolve_workspace_membership(
            future,
            principal(),
            tenant_id=TENANT,
            required_geography_id=COUNTY,
            run_id=RUN,
            as_of=NOW,
        )

    revoked = ScriptedConnection(
        [[("revoked", "planner", [], "membership:revoked", OLD_TIME, None)]]
    )
    with pytest.raises(PermissionError, match="revoked"):
        resolve_workspace_membership(
            revoked,
            principal(),
            tenant_id=TENANT,
            required_geography_id=COUNTY,
            run_id=RUN,
            as_of=NOW,
        )


def test_idempotent_run_identity_returns_original_immutable_audit_metadata():
    connection = ScriptedConnection(
        [
            None,
            (RUN, TENANT, COUNTY, "36001", "principal:original", OLD_TIME),
        ]
    )
    identity = persist_county_run_identity(connection, run(), actor=actor())
    assert identity.created_by == "principal:original"
    assert identity.created_at == OLD_TIME
    assert identity.tenant_id == TENANT
    assert identity.geography_id == COUNTY


def test_idempotent_state_retry_returns_original_audit_metadata_without_insert():
    county_run = run(status=RunStatus.RUNNING)
    state_hash = county_run_state_hash(county_run)
    state_id = "county-run-state:sha256:" + state_hash.removeprefix("sha256:")
    connection = ScriptedConnection(
        [
            (TENANT, COUNTY, "36001"),
            (state_id, 4, state_hash, "running", "principal:original", OLD_TIME),
        ]
    )
    version = append_county_run_state(connection, county_run, actor=actor())
    assert version.version_no == 4
    assert version.recorded_by == "principal:original"
    assert version.recorded_at == OLD_TIME
    assert version.status == "running"
    assert len(connection.executions) == 2
    assert not any("INSERT INTO cbcap.county_run_state_version" in query for query, _ in connection.executions)


def test_changed_state_appends_exactly_one_next_version():
    county_run = run(status=RunStatus.RUNNING)
    state_hash = county_run_state_hash(county_run)
    connection = ScriptedConnection(
        [
            (TENANT, COUNTY, "36001"),
            ("county-run-state:sha256:" + "a" * 64, 4, "sha256:" + "a" * 64, "created", "principal:old", OLD_TIME),
            None,
        ]
    )
    version = append_county_run_state(connection, county_run, actor=actor())
    assert version.version_no == 5
    assert version.state_hash == state_hash
    assert version.recorded_by == actor().actor_id
    inserts = [query for query, _ in connection.executions if "INSERT INTO cbcap.county_run_state_version" in query]
    assert len(inserts) == 1

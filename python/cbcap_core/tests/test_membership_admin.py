from contextlib import contextmanager
from datetime import datetime, timedelta, timezone

import pytest

from cbcap_core.identity_adapter import VerifiedExternalPrincipal
from cbcap_core.membership_admin import (
    MembershipAdminRequest,
    _event_id,
    _principal_key,
    record_membership_event,
)
from cbcap_core.runtime_registry import verified_principal_key

NOW = datetime(2026, 8, 23, 18, 30, tzinfo=timezone.utc)
ISSUER = "https://cognito-idp.us-east-1.amazonaws.com/us-east-1_Example123"
SUBJECT = "cognito-subject-123"
TENANT = "tenant:albany-planning"


class Result:
    def __init__(self, row=None):
        self.row = row

    def fetchone(self):
        return self.row


class FakeConnection:
    def __init__(self, existing=None):
        self.existing = existing
        self.executions = []
        self.transactions = 0

    @contextmanager
    def transaction(self):
        self.transactions += 1
        yield

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.executions.append((normalized, params))
        if normalized.startswith("SELECT id, decision, role"):
            return Result(self.existing)
        return Result()


def request(*, decision="granted", role="admin", geography_ids=("county:36001",), version="bootstrap:v1"):
    return MembershipAdminRequest(
        tenant_id=TENANT,
        principal_key=_principal_key(issuer=ISSUER, subject=SUBJECT),
        decision=decision,
        role=role,
        geography_ids=geography_ids,
        membership_version=version,
        recorded_by="aws-admin:bootstrap",
        expires_at=NOW + timedelta(days=365),
    )


def membership_env(monkeypatch):
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_DECISION", "granted")
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_ROLE", "planner")
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_TENANT_ID", TENANT)
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_VERSION", "grant:v1")
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_RECORDED_BY", "aws-admin")
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_GEOGRAPHY_IDS", "county:36001,county:36093")
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_EXPIRES_AT", "2027-08-23T18:30:00Z")


def test_admin_principal_key_matches_runtime_authorization_identity():
    principal = VerifiedExternalPrincipal(
        subject=SUBJECT,
        issuer=ISSUER,
        session_id="session",
        verification_method="oidc_jwt_verified",
        authenticated_at=NOW - timedelta(minutes=5),
        expires_at=NOW + timedelta(minutes=30),
    )
    assert _principal_key(issuer=ISSUER, subject=SUBJECT) == verified_principal_key(principal)


def test_admin_environment_requires_canonical_county_scope(monkeypatch):
    membership_env(monkeypatch)
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_PRINCIPAL_ISSUER", ISSUER)
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_PRINCIPAL_SUBJECT", SUBJECT)
    monkeypatch.delenv("CB_CAP_MEMBERSHIP_PRINCIPAL_KEY", raising=False)

    parsed = MembershipAdminRequest.from_env()
    assert parsed.role == "planner"
    assert parsed.geography_ids == ("county:36001", "county:36093")
    assert parsed.principal_key.startswith("principal:sha256:")

    monkeypatch.setenv("CB_CAP_MEMBERSHIP_GEOGRAPHY_IDS", "36001")
    with pytest.raises(ValueError, match="canonical county IDs"):
        MembershipAdminRequest.from_env()


def test_admin_environment_prefers_opaque_principal_key_without_raw_subject(monkeypatch):
    membership_env(monkeypatch)
    opaque = _principal_key(issuer=ISSUER, subject=SUBJECT)
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_PRINCIPAL_KEY", opaque)
    monkeypatch.delenv("CB_CAP_MEMBERSHIP_PRINCIPAL_ISSUER", raising=False)
    monkeypatch.delenv("CB_CAP_MEMBERSHIP_PRINCIPAL_SUBJECT", raising=False)

    parsed = MembershipAdminRequest.from_env()
    assert parsed.principal_key == opaque

    monkeypatch.setenv("CB_CAP_MEMBERSHIP_PRINCIPAL_KEY", "principal:raw-subject")
    with pytest.raises(ValueError, match="PRINCIPAL_KEY is invalid"):
        MembershipAdminRequest.from_env()


def test_grant_requires_at_least_one_county_but_revoke_may_be_empty(monkeypatch):
    common = {
        "CB_CAP_MEMBERSHIP_ROLE": "admin",
        "CB_CAP_MEMBERSHIP_TENANT_ID": TENANT,
        "CB_CAP_MEMBERSHIP_VERSION": "event:v1",
        "CB_CAP_MEMBERSHIP_RECORDED_BY": "aws-admin",
        "CB_CAP_MEMBERSHIP_PRINCIPAL_KEY": _principal_key(issuer=ISSUER, subject=SUBJECT),
        "CB_CAP_MEMBERSHIP_GEOGRAPHY_IDS": "",
    }
    for key, value in common.items():
        monkeypatch.setenv(key, value)
    monkeypatch.setenv("CB_CAP_MEMBERSHIP_DECISION", "granted")
    with pytest.raises(ValueError, match="at least one county"):
        MembershipAdminRequest.from_env()

    monkeypatch.setenv("CB_CAP_MEMBERSHIP_DECISION", "revoked")
    parsed = MembershipAdminRequest.from_env()
    assert parsed.geography_ids == ()


def test_membership_event_sets_tenant_rls_scope_and_inserts_append_only_record():
    connection = FakeConnection()
    item = request()
    event_id = record_membership_event(connection, item, recorded_at=NOW)

    assert connection.transactions == 1
    assert event_id == _event_id(item)
    assert connection.executions[0][0] == "SELECT set_config('app.tenant_id', %s, true)"
    assert connection.executions[0][1] == (TENANT,)
    insert = [entry for entry in connection.executions if entry[0].startswith("INSERT INTO cbcap.workspace_membership_event")]
    assert len(insert) == 1
    assert "DO UPDATE" not in insert[0][0].upper()


def test_same_membership_version_is_idempotent_only_for_identical_content():
    item = request()
    event_id = _event_id(item)
    existing = (
        event_id,
        item.decision,
        item.role,
        list(item.geography_ids),
        item.recorded_by,
        item.expires_at,
    )
    connection = FakeConnection(existing=existing)
    assert record_membership_event(connection, item, recorded_at=NOW) == event_id
    assert not any(entry[0].startswith("INSERT INTO cbcap.workspace_membership_event") for entry in connection.executions)

    changed = request(role="reviewer")
    connection = FakeConnection(existing=existing)
    with pytest.raises(RuntimeError, match="different immutable content"):
        record_membership_event(connection, changed, recorded_at=NOW)


def test_membership_expiry_must_be_future():
    expired = MembershipAdminRequest(
        **{**request().__dict__, "expires_at": NOW - timedelta(seconds=1)}
    )
    with pytest.raises(ValueError, match="future"):
        record_membership_event(FakeConnection(), expired, recorded_at=NOW)

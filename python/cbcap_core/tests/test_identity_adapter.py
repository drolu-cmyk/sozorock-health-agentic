from datetime import datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from cbcap_core.authorization import ROLE_CAPABILITIES, require_actor_capability
from cbcap_core.identity_adapter import (
    IdentityProjectionPolicy,
    ResolvedWorkspaceMembership,
    VerifiedExternalPrincipal,
    project_verified_identity,
)

ISSUER = "https://identity.example.test/pool/verified"
SUBJECT = "user-opaque-subject-123"
TENANT = "tenant:albany-planning"
COUNTY = "county:36001"
RUN = "run:identity:36001"
NOW = datetime(2026, 8, 23, 14, 0, tzinfo=timezone.utc)


def principal(**updates):
    payload = {
        "subject": SUBJECT,
        "issuer": ISSUER,
        "session_id": "session:verified:1",
        "verification_method": "oidc_jwt_verified",
        "authenticated_at": NOW - timedelta(minutes=5),
        "expires_at": NOW + timedelta(hours=1),
    }
    payload.update(updates)
    return VerifiedExternalPrincipal(**payload)


def membership(**updates):
    payload = {
        "principal_subject": SUBJECT,
        "principal_issuer": ISSUER,
        "tenant_id": TENANT,
        "role": "planner",
        "geography_ids": [COUNTY],
        "run_ids": [RUN],
        "membership_version": "membership:v3",
        "resolved_at": NOW - timedelta(seconds=10),
    }
    payload.update(updates)
    return ResolvedWorkspaceMembership(**payload)


def policy(**updates):
    payload = {
        "trusted_issuers": [ISSUER],
        "grant_ttl_seconds": 900,
        "max_auth_age_seconds": 43200,
    }
    payload.update(updates)
    return IdentityProjectionPolicy(**payload)


def test_verified_identity_and_server_membership_project_to_bounded_actor():
    actor = project_verified_identity(principal(), membership(), policy(), as_of=NOW)
    assert actor.tenant_id == TENANT
    assert actor.role == "planner"
    assert set(actor.authorization.capabilities) == set(ROLE_CAPABILITIES["planner"])
    assert actor.authorization.geography_ids == [COUNTY]
    assert actor.authorization.run_ids == [RUN]
    assert actor.authorization.expires_at == NOW + timedelta(minutes=15)
    assert SUBJECT not in actor.actor_id
    assert actor.actor_id.startswith("principal:sha256:")


def test_untrusted_issuer_fails_closed():
    with pytest.raises(PermissionError, match="issuer"):
        project_verified_identity(
            principal(issuer="https://attacker.example.test"),
            membership(),
            policy(),
            as_of=NOW,
        )


def test_membership_must_bind_to_exact_verified_subject_and_issuer():
    with pytest.raises(PermissionError, match="subject"):
        project_verified_identity(
            principal(),
            membership(principal_subject="different-subject"),
            policy(),
            as_of=NOW,
        )
    with pytest.raises(PermissionError, match="issuer"):
        project_verified_identity(
            principal(),
            membership(principal_issuer="https://different.example.test"),
            policy(),
            as_of=NOW,
        )


def test_membership_cannot_inject_capabilities_or_actor_identity():
    with pytest.raises(ValidationError):
        ResolvedWorkspaceMembership(
            **membership().model_dump(mode="python"),
            capabilities=["approve_publication"],
        )
    with pytest.raises(ValidationError):
        ResolvedWorkspaceMembership(
            **membership().model_dump(mode="python"),
            actor_id="principal:spoofed",
        )


def test_role_mapping_does_not_escalate_beyond_server_resolved_role():
    actor = project_verified_identity(
        principal(),
        membership(role="analyst"),
        policy(),
        as_of=NOW,
    )
    assert set(actor.authorization.capabilities) == set(ROLE_CAPABILITIES["analyst"])
    with pytest.raises(PermissionError, match="approve_publication"):
        require_actor_capability(
            actor,
            "approve_publication",
            geography_id=COUNTY,
            run_id=RUN,
            as_of=NOW,
        )


def test_expired_or_stale_identity_cannot_create_new_runtime_grant():
    with pytest.raises(PermissionError, match="expired"):
        project_verified_identity(
            principal(expires_at=NOW),
            membership(),
            policy(),
            as_of=NOW,
        )
    with pytest.raises(PermissionError, match="too old"):
        project_verified_identity(
            principal(
                authenticated_at=NOW - timedelta(hours=13),
                expires_at=NOW + timedelta(hours=1),
            ),
            membership(),
            policy(max_auth_age_seconds=43200),
            as_of=NOW,
        )


def test_geography_and_run_scope_remain_fail_closed_after_projection():
    actor = project_verified_identity(principal(), membership(), policy(), as_of=NOW)
    with pytest.raises(PermissionError, match="geography"):
        require_actor_capability(
            actor,
            "execute_county_run",
            geography_id="county:42029",
            as_of=NOW,
        )
    with pytest.raises(PermissionError, match="county run"):
        require_actor_capability(
            actor,
            "decide_funding_pursuit",
            geography_id=COUNTY,
            run_id="run:other",
            as_of=NOW,
        )


def test_future_membership_resolution_is_rejected():
    with pytest.raises(PermissionError, match="future"):
        project_verified_identity(
            principal(),
            membership(resolved_at=NOW + timedelta(seconds=1)),
            policy(),
            as_of=NOW,
        )

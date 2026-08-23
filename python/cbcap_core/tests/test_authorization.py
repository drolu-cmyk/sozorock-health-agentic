from datetime import datetime, timezone

import pytest
from pydantic import ValidationError

from cbcap_core.authorization import (
    AuthorizationGrant,
    AuthorizedActor,
    require_actor_capability,
)

ISSUED = datetime(2026, 1, 1, tzinfo=timezone.utc)
ACTIVE = datetime(2026, 8, 22, tzinfo=timezone.utc)
EXPIRES = datetime(2027, 1, 1, tzinfo=timezone.utc)
TENANT = "tenant:a"
COUNTY = "county:36001"
RUN = "run:1"


def grant(**updates) -> AuthorizationGrant:
    payload = {
        "grant_id": "grant:1",
        "actor_id": "principal:1",
        "tenant_id": TENANT,
        "capabilities": ["read_workspace", "execute_county_run"],
        "geography_ids": [COUNTY],
        "run_ids": [RUN],
        "issuer": "trusted-app-identity-verifier",
        "issued_at": ISSUED,
        "expires_at": EXPIRES,
    }
    payload.update(updates)
    return AuthorizationGrant(**payload)


def actor(*, role="planner", authorization=None) -> AuthorizedActor:
    selected = authorization or grant()
    return AuthorizedActor(
        actor_id=selected.actor_id,
        tenant_id=selected.tenant_id,
        role=role,
        authorization=selected,
    )


def test_grant_requires_timezone_aware_validity_and_unique_scope():
    with pytest.raises(ValidationError, match="timezone-aware"):
        grant(issued_at=datetime(2026, 1, 1))

    with pytest.raises(ValidationError, match="later than"):
        grant(expires_at=ISSUED)

    with pytest.raises(ValidationError, match="capabilities must be unique"):
        grant(capabilities=["read_workspace", "read_workspace"])

    with pytest.raises(ValidationError, match="geography IDs must be unique"):
        grant(geography_ids=[COUNTY, COUNTY])


def test_actor_binding_prevents_principal_tenant_and_role_escalation():
    with pytest.raises(ValidationError, match="actor"):
        AuthorizedActor(
            actor_id="principal:other",
            tenant_id=TENANT,
            role="planner",
            authorization=grant(),
        )

    with pytest.raises(ValidationError, match="tenant"):
        AuthorizedActor(
            actor_id="principal:1",
            tenant_id="tenant:other",
            role="planner",
            authorization=grant(),
        )

    escalated = grant(capabilities=["approve_publication"])
    with pytest.raises(ValidationError, match="exceeds role capabilities"):
        actor(role="planner", authorization=escalated)


def test_capability_geography_and_run_are_all_explicit():
    authorized = actor()
    require_actor_capability(
        authorized,
        "execute_county_run",
        geography_id=COUNTY,
        as_of=ACTIVE,
    )

    with pytest.raises(PermissionError, match="resume_human_review"):
        require_actor_capability(
            authorized,
            "resume_human_review",
            run_id=RUN,
            as_of=ACTIVE,
        )

    with pytest.raises(PermissionError, match="geography"):
        require_actor_capability(
            authorized,
            "execute_county_run",
            geography_id="county:42029",
            as_of=ACTIVE,
        )

    reviewer_grant = grant(
        capabilities=["read_workspace", "resume_human_review"],
    )
    reviewer = actor(role="reviewer", authorization=reviewer_grant)
    require_actor_capability(
        reviewer,
        "resume_human_review",
        run_id=RUN,
        as_of=ACTIVE,
    )
    with pytest.raises(PermissionError, match="county run"):
        require_actor_capability(
            reviewer,
            "resume_human_review",
            run_id="run:other",
            as_of=ACTIVE,
        )


def test_not_yet_valid_and_expired_grants_fail_closed():
    authorized = actor()
    with pytest.raises(PermissionError, match="not yet valid"):
        require_actor_capability(
            authorized,
            "execute_county_run",
            geography_id=COUNTY,
            as_of=datetime(2025, 12, 31, tzinfo=timezone.utc),
        )
    with pytest.raises(PermissionError, match="expired"):
        require_actor_capability(
            authorized,
            "execute_county_run",
            geography_id=COUNTY,
            as_of=EXPIRES,
        )

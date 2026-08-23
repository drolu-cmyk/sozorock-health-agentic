from __future__ import annotations

from datetime import datetime, timezone
from typing import Literal

from pydantic import Field, model_validator

from .models import StrictModel

RuntimeRole = Literal["read_only", "analyst", "planner", "reviewer", "admin"]
RuntimeCapability = Literal[
    "read_workspace",
    "execute_county_run",
    "resume_human_review",
    "record_workspace_proposal",
    "record_workspace_review",
    "review_funding_fit",
    "decide_funding_pursuit",
    "approve_publication",
    "manage_forecast_governance",
]

ROLE_CAPABILITIES: dict[RuntimeRole, frozenset[RuntimeCapability]] = {
    "read_only": frozenset({"read_workspace"}),
    "analyst": frozenset({
        "read_workspace",
        "execute_county_run",
        "record_workspace_proposal",
    }),
    "planner": frozenset({
        "read_workspace",
        "execute_county_run",
        "record_workspace_proposal",
        "decide_funding_pursuit",
    }),
    "reviewer": frozenset({
        "read_workspace",
        "execute_county_run",
        "resume_human_review",
        "record_workspace_proposal",
        "record_workspace_review",
        "review_funding_fit",
        "decide_funding_pursuit",
        "approve_publication",
    }),
    "admin": frozenset({
        "read_workspace",
        "execute_county_run",
        "resume_human_review",
        "record_workspace_proposal",
        "record_workspace_review",
        "review_funding_fit",
        "decide_funding_pursuit",
        "approve_publication",
        "manage_forecast_governance",
    }),
}


class AuthorizationGrant(StrictModel):
    """Scoped authorization projected from an already authenticated application session.

    This object does not verify JWTs or credentials. A trusted application-layer
    identity verifier must create it after authentication. CB-CAP then enforces
    the explicit capability, tenant, county and run scope carried here.
    """

    grant_id: str = Field(min_length=1)
    actor_id: str = Field(min_length=1)
    tenant_id: str | None = None
    capabilities: list[RuntimeCapability] = Field(min_length=1)
    geography_ids: list[str] = Field(default_factory=list)
    run_ids: list[str] = Field(default_factory=list)
    issuer: str = Field(min_length=1)
    issued_at: datetime
    expires_at: datetime

    @model_validator(mode="after")
    def validate_grant(self) -> "AuthorizationGrant":
        if self.issued_at.tzinfo is None or self.issued_at.utcoffset() is None:
            raise ValueError("authorization issued_at must be timezone-aware")
        if self.expires_at.tzinfo is None or self.expires_at.utcoffset() is None:
            raise ValueError("authorization expires_at must be timezone-aware")
        if self.expires_at <= self.issued_at:
            raise ValueError("authorization expires_at must be later than issued_at")
        if len(set(self.capabilities)) != len(self.capabilities):
            raise ValueError("authorization capabilities must be unique")
        if len(set(self.geography_ids)) != len(self.geography_ids):
            raise ValueError("authorization geography IDs must be unique")
        if len(set(self.run_ids)) != len(self.run_ids):
            raise ValueError("authorization run IDs must be unique")
        if any(not item.strip() for item in self.geography_ids):
            raise ValueError("authorization geography IDs cannot be blank")
        if any(not item.strip() for item in self.run_ids):
            raise ValueError("authorization run IDs cannot be blank")
        return self


class AuthorizedActor(StrictModel):
    """Authenticated principal plus one bounded runtime authorization grant."""

    actor_id: str = Field(min_length=1)
    tenant_id: str | None = None
    role: RuntimeRole
    authorization: AuthorizationGrant

    @model_validator(mode="after")
    def validate_actor_binding(self) -> "AuthorizedActor":
        if self.authorization.actor_id != self.actor_id:
            raise ValueError("authorization grant actor does not match authenticated actor")
        if self.authorization.tenant_id != self.tenant_id:
            raise ValueError("authorization grant tenant does not match authenticated actor tenant")
        excessive = set(self.authorization.capabilities) - set(ROLE_CAPABILITIES[self.role])
        if excessive:
            raise ValueError(
                "authorization grant exceeds role capabilities: "
                + ", ".join(sorted(excessive))
            )
        return self


def require_actor_capability(
    actor: AuthorizedActor,
    capability: RuntimeCapability,
    *,
    geography_id: str | None = None,
    run_id: str | None = None,
    as_of: datetime | None = None,
) -> None:
    """Fail closed unless the actor has a current explicit grant for the action and scope."""

    now = as_of or datetime.now(timezone.utc)
    if now.tzinfo is None or now.utcoffset() is None:
        raise ValueError("authorization evaluation time must be timezone-aware")
    grant = actor.authorization
    if now < grant.issued_at:
        raise PermissionError("authorization grant is not yet valid")
    if now >= grant.expires_at:
        raise PermissionError("authorization grant has expired")
    if capability not in grant.capabilities:
        raise PermissionError(f"authenticated actor lacks capability: {capability}")
    if geography_id is not None and geography_id not in grant.geography_ids:
        raise PermissionError("authenticated actor is not authorized for this geography")
    if run_id is not None and run_id not in grant.run_ids:
        raise PermissionError("authenticated actor is not authorized for this county run")

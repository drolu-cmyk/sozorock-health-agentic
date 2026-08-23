from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone

from pydantic import Field

from .authorization import AuthorizedActor, require_actor_capability
from .decision_memory import (
    DecisionMemoryProposal,
    DecisionMemoryRecord,
    DecisionMemoryWriteRequest,
    build_decision_memory,
)
from .models import (
    CountyRunState,
    ReviewDecision,
    StrictModel,
    WorkflowFlags,
)
from .persistence import ConnectionLike, persist_decision_memory
from .workspace import (
    DecisionWorkspaceContract,
    DecisionWorkspaceRequest,
    build_decision_workspace,
)


class PublicationAlreadyAuthorizedError(RuntimeError):
    pass


class PublicationApprovalRequest(StrictModel):
    """Publication intent only. Authenticated identity and time are service data."""

    county_run: CountyRunState
    reason_codes: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)
    evidence_entity_ids: list[str] = Field(min_length=1)


class PublicationAuthorizationRecord(StrictModel):
    id: str = Field(min_length=1)
    tenant_id: str = Field(min_length=1)
    run_id: str = Field(min_length=1)
    geography_id: str = Field(min_length=1)
    source_state_hash: str = Field(pattern=r"^sha256:[0-9a-fA-F]{64}$")
    approved_state_hash: str = Field(pattern=r"^sha256:[0-9a-fA-F]{64}$")
    decision_memory_id: str = Field(min_length=1)
    review_decision_id: str = Field(min_length=1)
    evidence_entity_ids: list[str] = Field(min_length=1)
    reason_codes: list[str] = Field(min_length=1)
    rationale: str = Field(min_length=1)
    decided_by: str = Field(min_length=1)
    actor_role: str = Field(pattern=r"^(reviewer|admin)$")
    authorization_grant_id: str = Field(min_length=1)
    authorization_issuer: str = Field(min_length=1)
    authorization_capability: str = Field(default="approve_publication", pattern=r"^approve_publication$")
    decided_at: datetime


class PublicationApprovalResult(StrictModel):
    workspace: DecisionWorkspaceContract
    memory: DecisionMemoryRecord
    authorization: PublicationAuthorizationRecord
    updated_run: CountyRunState


def county_run_state_hash(run: CountyRunState) -> str:
    encoded = json.dumps(
        run.model_dump(mode="json"),
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(encoded).hexdigest()


def _authorization_id(payload: dict) -> str:
    encoded = json.dumps(
        payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    ).encode("utf-8")
    return "publication-authorization:sha256:" + hashlib.sha256(encoded).hexdigest()


def _updated_run_after_approval(
    run: CountyRunState,
    *,
    review_decision: ReviewDecision,
) -> CountyRunState:
    flags = WorkflowFlags.model_validate(
        {
            **run.flags.model_dump(mode="python"),
            "publication_approved": True,
        }
    )
    reviews = [*run.reviews, review_decision]
    return CountyRunState.model_validate(
        {
            **run.model_dump(mode="python"),
            "flags": flags,
            "reviews": reviews,
        }
    )


def prepare_publication_approval(
    request: PublicationApprovalRequest,
    *,
    actor: AuthorizedActor,
) -> PublicationApprovalResult:
    run = request.county_run
    if run.tenant_id is None:
        raise ValueError("publication approval requires a tenant-scoped county run")
    if actor.tenant_id != run.tenant_id:
        raise ValueError("publication approval tenant does not match authenticated actor tenant")

    # Capability, county and run scope are checked before the governed workspace
    # is built or any publication ledger row is queried.
    require_actor_capability(
        actor,
        "approve_publication",
        geography_id=run.county.id,
        run_id=run.run_id,
    )
    if run.flags.publication_approved:
        raise ValueError("county run is already marked publication approved")

    workspace = build_decision_workspace(
        DecisionWorkspaceRequest(
            county_run=run,
            question="how_entities_are_connected",
            role=actor.role,
            actor_tenant_id=actor.tenant_id,
        )
    )
    if workspace.publication_state != "safe_not_approved":
        raise ValueError("publication approval requires a governed safe_not_approved workspace")
    if "approve_publication" not in workspace.allowed_actions:
        raise PermissionError("publication approval is not authorized by the current workspace")

    authoritative_ids = set(workspace.authoritative_entity_ids)
    unsupported = sorted(set(request.evidence_entity_ids) - authoritative_ids)
    if unsupported:
        raise ValueError(
            "publication approval references evidence outside governed authoritative lineage: "
            + ", ".join(unsupported)
        )

    decided_at = datetime.now(timezone.utc)
    source_state_hash = county_run_state_hash(run)
    review_decision = ReviewDecision(
        id=_authorization_id(
            {
                "kind": "review-decision",
                "run_id": run.run_id,
                "tenant_id": run.tenant_id,
                "source_state_hash": source_state_hash,
                "actor_id": actor.actor_id,
                "authorization_grant_id": actor.authorization.grant_id,
                "decided_at": decided_at.isoformat(),
            }
        ).replace("publication-authorization:", "review-decision:"),
        tenant_id=run.tenant_id,
        entity_type="county_run",
        entity_id=run.run_id,
        decision="approved",
        decided_by=actor.actor_id,
        decided_at=decided_at,
        reason=request.rationale,
    )
    updated_run = _updated_run_after_approval(run, review_decision=review_decision)
    approved_state_hash = county_run_state_hash(updated_run)

    memory = build_decision_memory(
        DecisionMemoryWriteRequest(
            proposal=DecisionMemoryProposal(
                tenant_id=run.tenant_id,
                geography_id=run.county.id,
                decision_type="publication_decision",
                subject_type="county_run",
                subject_id=run.run_id,
                outcome="accepted",
                reason_codes=request.reason_codes,
                rationale=request.rationale,
                evidence_entity_ids=request.evidence_entity_ids,
                related_entity_ids=[review_decision.id],
                missing_requirements=[],
                applicability="context_specific",
            ),
            actor_tenant_id=run.tenant_id,
            actor_id=actor.actor_id,
            actor_role=actor.role,
            decided_at=decided_at,
            approve_as_reviewed=True,
        )
    )

    authorization = PublicationAuthorizationRecord(
        id=_authorization_id(
            {
                "tenant_id": run.tenant_id,
                "run_id": run.run_id,
                "source_state_hash": source_state_hash,
                "approved_state_hash": approved_state_hash,
                "decision_memory_id": memory.id,
                "review_decision_id": review_decision.id,
                "authorization_grant_id": actor.authorization.grant_id,
                "decided_by": actor.actor_id,
                "decided_at": decided_at.isoformat(),
            }
        ),
        tenant_id=run.tenant_id,
        run_id=run.run_id,
        geography_id=run.county.id,
        source_state_hash=source_state_hash,
        approved_state_hash=approved_state_hash,
        decision_memory_id=memory.id,
        review_decision_id=review_decision.id,
        evidence_entity_ids=list(dict.fromkeys(request.evidence_entity_ids)),
        reason_codes=sorted(set(request.reason_codes)),
        rationale=request.rationale,
        decided_by=actor.actor_id,
        actor_role=actor.role,
        authorization_grant_id=actor.authorization.grant_id,
        authorization_issuer=actor.authorization.issuer,
        authorization_capability="approve_publication",
        decided_at=decided_at,
    )
    return PublicationApprovalResult(
        workspace=workspace,
        memory=memory,
        authorization=authorization,
        updated_run=updated_run,
    )


def apply_publication_authorization(
    run: CountyRunState,
    authorization: PublicationAuthorizationRecord,
) -> CountyRunState:
    """Rehydrate publication state only onto the exact reviewed county state."""

    if authorization.tenant_id != run.tenant_id:
        raise ValueError("publication authorization tenant does not match county run")
    if authorization.run_id != run.run_id:
        raise ValueError("publication authorization run does not match county run")
    if authorization.geography_id != run.county.id:
        raise ValueError("publication authorization geography does not match county run")

    current_hash = county_run_state_hash(run)
    if current_hash == authorization.approved_state_hash:
        if not run.flags.publication_approved:
            raise ValueError("approved state hash requires publication_approved canonical state")
        return run
    if current_hash != authorization.source_state_hash:
        raise ValueError("publication authorization cannot be applied after county state changed")

    review_decision = ReviewDecision(
        id=authorization.review_decision_id,
        tenant_id=authorization.tenant_id,
        entity_type="county_run",
        entity_id=authorization.run_id,
        decision="approved",
        decided_by=authorization.decided_by,
        decided_at=authorization.decided_at,
        reason=authorization.rationale,
    )
    updated = _updated_run_after_approval(run, review_decision=review_decision)
    if county_run_state_hash(updated) != authorization.approved_state_hash:
        raise ValueError("publication authorization does not reproduce approved county state")
    return updated


def record_publication_approval(
    connection: ConnectionLike,
    request: PublicationApprovalRequest,
    *,
    actor: AuthorizedActor,
) -> PublicationApprovalResult:
    """Persist reviewed memory and publication authority in one transaction."""

    # prepare_publication_approval performs capability + county + run checks
    # before the first publication-ledger query.
    result = prepare_publication_approval(request, actor=actor)
    authorization = result.authorization
    tenant_id = authorization.tenant_id

    try:
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant_id,))
            cursor.execute(
                """
                SELECT id
                  FROM cbcap.publication_authorization
                 WHERE tenant_id=%s AND run_id=%s
                 LIMIT 1
                """,
                (tenant_id, authorization.run_id),
            )
            existing = cursor.fetchone()
            if existing is not None:
                raise PublicationAlreadyAuthorizedError(
                    "the county run already has a publication authorization"
                )

        persist_decision_memory(
            connection,
            result.memory,
            actor_tenant_id=tenant_id,
        )
        with connection.cursor() as cursor:
            cursor.execute("SELECT set_config('app.tenant_id', %s, true)", (tenant_id,))
            cursor.execute(
                """
                INSERT INTO cbcap.publication_authorization (
                  id, tenant_id, run_id, geography_id,
                  source_state_hash, approved_state_hash,
                  decision_memory_id, review_decision_id,
                  evidence_entity_ids, reason_codes, rationale,
                  decided_by, actor_role,
                  authorization_grant_id, authorization_issuer,
                  authorization_capability, decided_at
                ) VALUES (
                  %s,%s,%s,%s,%s,%s,%s,%s,%s::jsonb,%s::jsonb,%s,
                  %s,%s,%s,%s,%s,%s
                )
                """,
                (
                    authorization.id,
                    authorization.tenant_id,
                    authorization.run_id,
                    authorization.geography_id,
                    authorization.source_state_hash,
                    authorization.approved_state_hash,
                    authorization.decision_memory_id,
                    authorization.review_decision_id,
                    json.dumps(authorization.evidence_entity_ids),
                    json.dumps(authorization.reason_codes),
                    authorization.rationale,
                    authorization.decided_by,
                    authorization.actor_role,
                    authorization.authorization_grant_id,
                    authorization.authorization_issuer,
                    authorization.authorization_capability,
                    authorization.decided_at,
                ),
            )
        connection.commit()
    except Exception:
        connection.rollback()
        raise
    return result

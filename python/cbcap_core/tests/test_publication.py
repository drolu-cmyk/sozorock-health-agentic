from __future__ import annotations

from datetime import date, datetime, timedelta, timezone

import pytest
from pydantic import ValidationError

from cbcap_core.models import (
    BarrierFamily,
    BarrierObservation,
    CountyRunState,
    GeographyKind,
    GeographyRef,
    Measure,
    MetricSemantics,
    ReviewStatus,
    SourceVersionRef,
    WorkflowFlags,
)
from cbcap_core.publication import (
    PublicationAlreadyAuthorizedError,
    PublicationApprovalRequest,
    apply_publication_authorization,
    county_run_state_hash,
    prepare_publication_approval,
    record_publication_approval,
)
from cbcap_core.runtime_service import RuntimeActor

NOW = datetime(2026, 8, 22, 23, 58, tzinfo=timezone.utc)
TENANT = "tenant:albany-planning"


def actor(*, role="reviewer", tenant_id=TENANT, actor_id="principal:reviewer") -> RuntimeActor:
    return RuntimeActor(actor_id=actor_id, tenant_id=tenant_id, role=role)


def county() -> GeographyRef:
    return GeographyRef(
        id="county:36001",
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


def source() -> SourceVersionRef:
    return SourceVersionRef(
        source_id="cdc-places",
        source_version_id="cdc-places:2026",
        publisher="Centers for Disease Control and Prevention",
        title="PLACES",
        official_url="https://www.cdc.gov/places/",
        release_label="2026",
        release_date=date(2026, 8, 1),
        retrieved_at=NOW,
        content_hash="sha256:" + "a" * 64,
        schema_version="places.v1",
        review_status=ReviewStatus.VERIFIED,
    )


def measure(measure_id: str, *, status=ReviewStatus.VERIFIED) -> Measure:
    return Measure(
        id=f"measure:{measure_id}",
        semantics=MetricSemantics(
            id=f"metric:{measure_id}",
            source_measure_id=measure_id.upper(),
            name=measure_id.title(),
            description="Controlled publication authorization test measure.",
            direction="adverse",
            higher_value_meaning="adverse",
            unit="percent",
            universe="adults",
            adjustment="modeled",
            comparison_policy="higher_is_concern",
            allowed_geography_kinds=[GeographyKind.COUNTY],
            review_status=ReviewStatus.VERIFIED,
        ),
        geography=county(),
        source_version=source(),
        geography_level="county",
        value=12.0,
        numeric_value=12.0,
        review_status=status,
    )


def barrier(measure_id: str, family: BarrierFamily, *, status=ReviewStatus.VERIFIED):
    return BarrierObservation(
        id=f"barrier:{measure_id}",
        barrier_family=family,
        geography=county(),
        measure_id=f"measure:{measure_id}",
        observed_value=12.0,
        evidence_quality="high" if status == ReviewStatus.VERIFIED else "moderate",
        review_status=status,
    )


def run(*, safe=True, provisional=False, tenant_id=TENANT) -> CountyRunState:
    flags = WorkflowFlags()
    if safe:
        flags = WorkflowFlags(
            geography_verified=True,
            required_sources_complete=True,
            evidence_validated=True,
            policy_passed=True,
            safe_to_publish=True,
        )
    measures = [measure("transportation"), measure("housing")]
    barriers = [
        barrier("transportation", BarrierFamily.TRANSPORTATION_TRAVEL),
        barrier("housing", BarrierFamily.HOUSING),
    ]
    if provisional:
        measures.append(measure("food", status=ReviewStatus.PROVISIONAL))
        barriers.append(
            barrier("food", BarrierFamily.FOOD_SECURITY, status=ReviewStatus.PROVISIONAL)
        )
    return CountyRunState(
        run_id="publication-run:36001",
        tenant_id=tenant_id,
        county=county(),
        requested_at=NOW,
        flags=flags,
        measures=measures,
        barrier_observations=barriers,
    )


def request(county_run=None):
    return PublicationApprovalRequest(
        county_run=county_run or run(),
        reason_codes=["publication_requirements_satisfied"],
        rationale="Verified governed evidence is complete and approved for publication.",
        evidence_entity_ids=["measure:transportation", "measure:housing"],
    )


class FakeCursor:
    def __init__(self, connection):
        self.connection = connection
        self._existing = None

    def __enter__(self):
        return self

    def __exit__(self, exc_type, exc, tb):
        return False

    def execute(self, query, params=None):
        normalized = " ".join(query.split())
        self.connection.executions.append((normalized, params))
        if "SELECT id FROM cbcap.publication_authorization" in normalized:
            self._existing = ("publication:existing",) if self.connection.existing else None
        if (
            self.connection.fail_publication_insert
            and "INSERT INTO cbcap.publication_authorization" in normalized
        ):
            raise RuntimeError("simulated publication insert failure")

    def fetchone(self):
        return self._existing


class FakeConnection:
    def __init__(self, *, existing=False, fail_publication_insert=False):
        self.existing = existing
        self.fail_publication_insert = fail_publication_insert
        self.executions = []
        self.commits = 0
        self.rollbacks = 0

    def cursor(self):
        return FakeCursor(self)

    def commit(self):
        self.commits += 1

    def rollback(self):
        self.rollbacks += 1


def test_publication_request_has_no_caller_identity_timestamp_or_review_override():
    payload = request().model_dump(mode="python")
    payload.update(
        {
            "actor_id": "impersonated:reviewer",
            "actor_role": "admin",
            "actor_tenant_id": TENANT,
            "decided_at": NOW,
            "approve_as_reviewed": True,
        }
    )
    with pytest.raises(ValidationError):
        PublicationApprovalRequest.model_validate(payload)


def test_reviewer_approval_binds_memory_and_authorization_to_exact_state():
    original = run()
    reviewer = actor(actor_id="principal:reviewer-42")
    result = prepare_publication_approval(request(original), actor=reviewer)

    assert result.workspace.publication_state == "safe_not_approved"
    assert result.memory.status == "reviewed"
    assert result.memory.decision_type == "publication_decision"
    assert result.memory.decided_by == reviewer.actor_id
    assert result.authorization.decided_by == reviewer.actor_id
    assert result.authorization.source_state_hash == county_run_state_hash(original)
    assert result.authorization.approved_state_hash == county_run_state_hash(result.updated_run)
    assert result.authorization.source_state_hash != result.authorization.approved_state_hash
    assert result.updated_run.flags.publication_approved is True
    assert result.updated_run.reviews[-1].decided_by == reviewer.actor_id


def test_only_reviewer_or_admin_can_authorize_publication():
    for role in ("read_only", "analyst", "planner"):
        with pytest.raises(PermissionError, match="reviewer or admin"):
            prepare_publication_approval(request(), actor=actor(role=role))


def test_publication_requires_safe_workspace_not_just_user_intent():
    with pytest.raises(ValueError, match="safe_not_approved"):
        prepare_publication_approval(request(run(safe=False)), actor=actor())

    # Even if flags are manually set safe, provisional governed evidence blocks approval.
    with pytest.raises(ValueError, match="safe_not_approved"):
        prepare_publication_approval(request(run(safe=True, provisional=True)), actor=actor())


def test_publication_requires_authoritative_supporting_evidence():
    bad = request().model_copy(update={"evidence_entity_ids": ["barrier:not-authoritative"]})
    with pytest.raises(ValueError, match="authoritative lineage"):
        prepare_publication_approval(bad, actor=actor())


def test_cross_tenant_and_tenantless_publication_fail_closed():
    with pytest.raises(ValueError, match="tenant"):
        prepare_publication_approval(request(), actor=actor(tenant_id="tenant:other"))

    with pytest.raises(ValueError, match="tenant-scoped"):
        prepare_publication_approval(
            request(run(tenant_id=None)),
            actor=actor(tenant_id=None),
        )


def test_authorization_rehydrates_only_the_exact_reviewed_preapproval_state():
    original = run()
    result = prepare_publication_approval(request(original), actor=actor())

    hydrated = apply_publication_authorization(original, result.authorization)
    assert county_run_state_hash(hydrated) == result.authorization.approved_state_hash
    assert hydrated.flags.publication_approved is True

    # Applying the same authorization to the already hydrated state is idempotent.
    assert apply_publication_authorization(hydrated, result.authorization) == hydrated

    changed = original.model_copy(update={"requested_at": NOW + timedelta(seconds=1)})
    with pytest.raises(ValueError, match="state changed"):
        apply_publication_authorization(changed, result.authorization)


def test_record_publication_approval_commits_memory_and_authorization_together():
    connection = FakeConnection()
    result = record_publication_approval(connection, request(), actor=actor())

    assert result.updated_run.flags.publication_approved is True
    assert connection.commits == 1
    assert connection.rollbacks == 0
    queries = [query for query, _ in connection.executions]
    memory_index = next(i for i, query in enumerate(queries) if "INSERT INTO cbcap.decision_memory" in query)
    auth_index = next(i for i, query in enumerate(queries) if "INSERT INTO cbcap.publication_authorization" in query)
    assert memory_index < auth_index


def test_publication_transaction_rolls_back_memory_if_authorization_insert_fails():
    connection = FakeConnection(fail_publication_insert=True)
    with pytest.raises(RuntimeError, match="simulated publication insert failure"):
        record_publication_approval(connection, request(), actor=actor())
    assert connection.commits == 0
    assert connection.rollbacks == 1
    assert any("INSERT INTO cbcap.decision_memory" in query for query, _ in connection.executions)


def test_existing_authorization_blocks_before_new_memory_insert():
    connection = FakeConnection(existing=True)
    with pytest.raises(PublicationAlreadyAuthorizedError):
        record_publication_approval(connection, request(), actor=actor())
    assert connection.commits == 0
    assert connection.rollbacks == 1
    assert not any("INSERT INTO cbcap.decision_memory" in query for query, _ in connection.executions)

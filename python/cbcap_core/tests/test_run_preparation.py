from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path

import pytest

from cbcap_core.gateway import EvidenceGatewayResponse
from cbcap_core.gateway_transport import EvidenceGatewayFetchResult, package_release_hash
from cbcap_core.graph import RunBudget
from cbcap_core.models import CountyRunState, GeographyKind, GeographyRef, ReviewStatus
from cbcap_core.run_preparation import CountyRunPreparationError, prepare_county_graph_run

FIXTURE = Path(__file__).parent / "fixtures" / "evidence-gateway-v1.json"
NOW = datetime(2026, 8, 22, 23, 30, tzinfo=timezone.utc)


def county_run() -> CountyRunState:
    return CountyRunState(
        run_id="run:albany:gateway-preparation",
        county=GeographyRef(
            id="county:36001",
            kind=GeographyKind.COUNTY,
            authority="census",
            authority_id="36001",
            name="Albany County, New York",
            display_name="Albany County, New York",
            state_fips="36",
            county_fips="36001",
            vintage="2025",
            review_status=ReviewStatus.VERIFIED,
        ),
        requested_at=NOW,
    )


def gateway_response() -> EvidenceGatewayResponse:
    package = json.loads(FIXTURE.read_text())
    release_hash = package_release_hash(package)
    return EvidenceGatewayResponse.model_validate(
        {
            "manifest": {
                "contract_version": "sozorock.evidence-gateway.v1",
                "release_id": package["release_id"],
                "generated_at": package["generated_at"],
                "evidence_core_schema_version": "evidence-core.fixture.v1",
                "release_hash": release_hash,
                "source_versions": package["source_versions"],
            },
            "package": package,
        }
    )


class FakeGatewayClient:
    def __init__(self, result: EvidenceGatewayFetchResult):
        self.result = result
        self.calls: list[tuple[str, str | None]] = []

    def fetch_county(self, county_fips: str, *, etag: str | None = None):
        self.calls.append((county_fips, etag))
        return self.result


def test_preparation_fetches_once_and_hands_one_immutable_package_to_graph_context():
    response = gateway_response()
    client = FakeGatewayClient(
        EvidenceGatewayFetchResult(
            response=response,
            etag=f'"{response.manifest.release_hash}"',
        )
    )
    prepared = prepare_county_graph_run(
        county_run(),
        RunBudget(max_external_calls=1),
        client,  # type: ignore[arg-type]
    )

    assert client.calls == [("36001", None)]
    assert prepared.external_calls_used == 1
    assert prepared.budget.preflight_external_calls_used == 1
    assert prepared.budget.external_calls_used == 1
    assert prepared.evidence_release_hash == response.manifest.release_hash
    assert prepared.context.public_evidence_package is not None
    assert prepared.context.public_evidence_package["release_id"] == response.manifest.release_id


def test_exhausted_external_call_budget_fails_before_network_call():
    response = gateway_response()
    client = FakeGatewayClient(EvidenceGatewayFetchResult(response=response, etag=None))

    with pytest.raises(CountyRunPreparationError, match="external-call budget"):
        prepare_county_graph_run(
            county_run(),
            RunBudget(max_external_calls=0),
            client,  # type: ignore[arg-type]
        )

    assert client.calls == []


def test_not_modified_requires_previously_validated_cached_response():
    response = gateway_response()
    etag = f'"{response.manifest.release_hash}"'
    client = FakeGatewayClient(
        EvidenceGatewayFetchResult(response=None, etag=etag, not_modified=True)
    )

    with pytest.raises(CountyRunPreparationError, match="no validated cached response"):
        prepare_county_graph_run(
            county_run(),
            RunBudget(max_external_calls=1),
            client,  # type: ignore[arg-type]
            etag=etag,
        )


def test_not_modified_reuses_only_cache_bound_to_same_release_hash():
    response = gateway_response()
    etag = f'"{response.manifest.release_hash}"'
    client = FakeGatewayClient(
        EvidenceGatewayFetchResult(response=None, etag=etag, not_modified=True)
    )

    prepared = prepare_county_graph_run(
        county_run(),
        RunBudget(
            max_external_calls=2,
            preflight_external_calls_used=1,
            external_calls_used=1,
        ),
        client,  # type: ignore[arg-type]
        etag=etag,
        cached_response=response,
    )
    assert prepared.budget.preflight_external_calls_used == 2
    assert prepared.budget.external_calls_used == 2
    assert prepared.evidence_release_id == response.manifest.release_id

    with pytest.raises(CountyRunPreparationError, match="does not match"):
        prepare_county_graph_run(
            county_run(),
            RunBudget(
                max_external_calls=2,
                preflight_external_calls_used=1,
                external_calls_used=1,
            ),
            client,  # type: ignore[arg-type]
            etag='"sha256:' + "0" * 64 + '"',
            cached_response=response,
        )

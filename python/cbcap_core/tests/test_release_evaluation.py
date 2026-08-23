from types import SimpleNamespace

import pytest

from cbcap_core.gateway_transport import EvidenceGatewayFetchResult
from cbcap_core.release_evaluation import (
    FIVE_COUNTY_EVALUATION,
    evaluate_five_county_gateway,
)


class FakeClient:
    def __init__(self, *, release_overrides=None, empty_measure_fips=None, wrong_county_fips=None):
        self.release_overrides = release_overrides or {}
        self.empty_measure_fips = empty_measure_fips
        self.wrong_county_fips = wrong_county_fips
        self.calls = []

    def fetch_county(self, county_fips, *, etag=None):
        self.calls.append((county_fips, etag))
        release_id, release_hash = self.release_overrides.get(
            county_fips,
            ("release:2026-08-23", "sha256:" + "a" * 64),
        )
        geography_fips = self.wrong_county_fips if county_fips == "36001" and self.wrong_county_fips else county_fips
        geography = SimpleNamespace(
            kind=SimpleNamespace(value="county"),
            county_fips=geography_fips,
        )
        package = SimpleNamespace(
            geographies=[geography],
            source_versions=[object()],
            metric_semantics=[object()],
            measures=[] if county_fips == self.empty_measure_fips else [object(), object()],
            source_coverage=[object()],
        )
        manifest = SimpleNamespace(
            contract_version="sozorock.evidence-gateway.v1",
            release_id=release_id,
            release_hash=release_hash,
        )
        return EvidenceGatewayFetchResult(
            response=SimpleNamespace(manifest=manifest, package=package),
            etag=f'"{release_hash}"',
            elapsed_ms=7,
        )


def test_release_gate_uses_the_locked_five_county_evaluation_set():
    assert [fips for fips, _ in FIVE_COUNTY_EVALUATION] == [
        "36001",
        "36093",
        "36057",
        "42029",
        "48029",
    ]


def test_release_gate_requires_one_consistent_published_release_across_all_counties():
    client = FakeClient()
    result = evaluate_five_county_gateway(client)

    assert len(result.counties) == 5
    assert result.contract == "sozorock.evidence-gateway.v1"
    assert result.release_id == "release:2026-08-23"
    assert result.release_hash == "sha256:" + "a" * 64
    assert [item.county_fips for item in result.counties] == [item[0] for item in FIVE_COUNTY_EVALUATION]
    assert all(item.measure_count == 2 for item in result.counties)
    assert client.calls == [(item[0], None) for item in FIVE_COUNTY_EVALUATION]


def test_release_gate_fails_if_counties_are_served_from_different_releases():
    client = FakeClient(
        release_overrides={
            "42029": ("release:other", "sha256:" + "b" * 64),
        }
    )
    with pytest.raises(RuntimeError, match="not pinned to one published release"):
        evaluate_five_county_gateway(client)


def test_release_gate_fails_if_a_county_has_no_measures():
    with pytest.raises(RuntimeError, match="no measures for 48029"):
        evaluate_five_county_gateway(FakeClient(empty_measure_fips="48029"))


def test_release_gate_fails_on_cross_county_response():
    with pytest.raises(RuntimeError, match="crossed the county boundary"):
        evaluate_five_county_gateway(FakeClient(wrong_county_fips="36093"))

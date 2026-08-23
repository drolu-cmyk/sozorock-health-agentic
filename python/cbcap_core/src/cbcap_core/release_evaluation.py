from __future__ import annotations

import json
import os
import re
from dataclasses import asdict, dataclass
from typing import Protocol

from .gateway_transport import EvidenceGatewayFetchResult, EvidenceGatewayHttpClient


FIVE_COUNTY_EVALUATION: tuple[tuple[str, str], ...] = (
    ("36001", "Albany County, New York"),
    ("36093", "Schenectady County, New York"),
    ("36057", "Montgomery County, New York"),
    ("42029", "Chester County, Pennsylvania"),
    ("48029", "Bexar County, Texas"),
)


class CountyGatewayClient(Protocol):
    def fetch_county(self, county_fips: str, *, etag: str | None = None) -> EvidenceGatewayFetchResult: ...


@dataclass(frozen=True)
class CountyReleaseEvaluation:
    county_fips: str
    county_name: str
    release_id: str
    release_hash: str
    source_version_count: int
    metric_semantics_count: int
    measure_count: int
    source_coverage_count: int
    elapsed_ms: int | None


@dataclass(frozen=True)
class FiveCountyReleaseEvaluation:
    contract: str
    release_id: str
    counties: tuple[CountyReleaseEvaluation, ...]


def evaluate_five_county_gateway(
    client: CountyGatewayClient,
    *,
    counties: tuple[tuple[str, str], ...] = FIVE_COUNTY_EVALUATION,
) -> FiveCountyReleaseEvaluation:
    if not counties:
        raise ValueError("release evaluation requires at least one county")

    evaluations: list[CountyReleaseEvaluation] = []
    expected_release_id: str | None = None
    expected_contract: str | None = None

    for county_fips, county_name in counties:
        result = client.fetch_county(county_fips)
        if result.not_modified or result.response is None:
            raise RuntimeError(f"release evaluation requires a complete response for county {county_fips}")

        response = result.response
        package = response.package
        manifest = response.manifest
        county_geographies = [
            item
            for item in package.geographies
            if item.kind.value == "county" and item.county_fips == county_fips
        ]
        if len(package.geographies) != 1 or len(county_geographies) != 1:
            raise RuntimeError(f"gateway crossed the county boundary for {county_fips}")
        if not package.source_versions:
            raise RuntimeError(f"gateway returned no source lineage for {county_fips}")
        if not package.metric_semantics:
            raise RuntimeError(f"gateway returned no metric semantics for {county_fips}")
        if not package.measures:
            raise RuntimeError(f"gateway returned no measures for {county_fips}")
        if not re.fullmatch(r"sha256:[0-9a-f]{64}", manifest.release_hash):
            raise RuntimeError(f"gateway returned an invalid package hash for {county_fips}")

        if expected_release_id is None:
            expected_release_id = manifest.release_id
            expected_contract = manifest.contract_version
        elif (
            manifest.release_id != expected_release_id
            or manifest.contract_version != expected_contract
        ):
            raise RuntimeError("five-county gateway responses are not pinned to one published release")

        evaluations.append(
            CountyReleaseEvaluation(
                county_fips=county_fips,
                county_name=county_name,
                release_id=manifest.release_id,
                release_hash=manifest.release_hash,
                source_version_count=len(package.source_versions),
                metric_semantics_count=len(package.metric_semantics),
                measure_count=len(package.measures),
                source_coverage_count=len(package.source_coverage),
                elapsed_ms=result.elapsed_ms,
            )
        )

    if expected_release_id is None or expected_contract is None:
        raise RuntimeError("five-county release evaluation produced no release identity")

    return FiveCountyReleaseEvaluation(
        contract=expected_contract,
        release_id=expected_release_id,
        counties=tuple(evaluations),
    )


def main() -> None:
    endpoint = os.getenv(
        "CB_CAP_EVIDENCE_GATEWAY_URL",
        "https://health.sozorockfoundation.org/api/evidence/v1/gateway",
    ).strip()
    client = EvidenceGatewayHttpClient(endpoint, timeout_seconds=15.0)
    evaluation = evaluate_five_county_gateway(client)
    print(json.dumps(asdict(evaluation), sort_keys=True, separators=(",", ":")))


if __name__ == "__main__":
    main()

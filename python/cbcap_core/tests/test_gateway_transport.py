from __future__ import annotations

import copy
import json
from pathlib import Path

import pytest

from cbcap_core.gateway import SHARED_EVIDENCE_CONTRACT_VERSION
from cbcap_core.gateway_transport import (
    EvidenceGatewayHttpClient,
    EvidenceGatewayTransportError,
    package_release_hash,
    validate_gateway_http_document,
)

FIXTURE = Path(__file__).parent / "fixtures" / "evidence-gateway-v1.json"


def response_document():
    package = json.loads(FIXTURE.read_text())
    release_hash = package_release_hash(package)
    document = {
        "manifest": {
            "contract_version": SHARED_EVIDENCE_CONTRACT_VERSION,
            "release_id": package["release_id"],
            "generated_at": package["generated_at"],
            "evidence_core_schema_version": "evidence-core.fixture.v1",
            "release_hash": release_hash,
            "source_versions": package["source_versions"],
        },
        "package": package,
    }
    headers = {
        "Content-Type": "application/json; charset=utf-8",
        "X-Evidence-Contract": SHARED_EVIDENCE_CONTRACT_VERSION,
        "X-Evidence-Release": package["release_id"],
        "X-Evidence-Release-Hash": release_hash,
        "ETag": f'"{release_hash}"',
    }
    return document, headers


def test_valid_gateway_document_passes_contract_hash_header_and_county_checks():
    document, headers = response_document()
    response = validate_gateway_http_document(
        document,
        headers,
        expected_county_fips="36001",
    )
    assert response.package.geographies[0].county_fips == "36001"
    assert response.manifest.release_hash == package_release_hash(document["package"])


def test_tampered_package_fails_release_hash_validation():
    document, headers = response_document()
    document = copy.deepcopy(document)
    document["package"]["measures"][0]["numeric_value"] = 999

    with pytest.raises(EvidenceGatewayTransportError, match="package hash mismatch"):
        validate_gateway_http_document(
            document,
            headers,
            expected_county_fips="36001",
        )


def test_header_hash_mismatch_fails_closed():
    document, headers = response_document()
    headers = dict(headers)
    headers["X-Evidence-Release-Hash"] = "sha256:" + "0" * 64

    with pytest.raises(EvidenceGatewayTransportError, match="hash header mismatch"):
        validate_gateway_http_document(
            document,
            headers,
            expected_county_fips="36001",
        )


def test_wrong_county_cannot_enter_requested_county_run():
    document, headers = response_document()
    with pytest.raises(EvidenceGatewayTransportError, match="geography boundary"):
        validate_gateway_http_document(
            document,
            headers,
            expected_county_fips="42029",
        )


def test_transport_requires_https_and_exact_gateway_path():
    with pytest.raises(ValueError, match="HTTPS"):
        EvidenceGatewayHttpClient(
            "http://health.sozorockfoundation.org/api/evidence/v1/gateway"
        )

    with pytest.raises(ValueError, match="path"):
        EvidenceGatewayHttpClient("https://health.sozorockfoundation.org/explore")

    with pytest.raises(ValueError, match="path"):
        EvidenceGatewayHttpClient(
            "https://health.sozorockfoundation.org/internal/api/evidence/v1/gateway"
        )


def test_transport_rejects_embedded_credentials_and_query_configuration():
    with pytest.raises(ValueError, match="authority"):
        EvidenceGatewayHttpClient(
            "https://user:secret@health.sozorockfoundation.org/api/evidence/v1/gateway"
        )

    with pytest.raises(ValueError, match="query"):
        EvidenceGatewayHttpClient(
            "https://health.sozorockfoundation.org/api/evidence/v1/gateway?geoid=36001"
        )


def test_transport_rejects_unvalidated_conditional_etag_before_network_access():
    client = EvidenceGatewayHttpClient(
        "https://health.sozorockfoundation.org/api/evidence/v1/gateway"
    )
    with pytest.raises(ValueError, match="ETag"):
        client.fetch_county("36001", etag='W/"untrusted-cache-token"')
    with pytest.raises(ValueError, match="ETag"):
        client.fetch_county("36001", etag="release\r\nInjected: value")

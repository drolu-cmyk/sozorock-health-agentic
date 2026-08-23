from __future__ import annotations

import hashlib
import json
from dataclasses import dataclass
from typing import Mapping
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener

from .gateway import (
    SHARED_EVIDENCE_CONTRACT_VERSION,
    EvidenceGatewayResponse,
)


class EvidenceGatewayTransportError(RuntimeError):
    pass


class _RejectRedirects(HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: ANN001
        raise EvidenceGatewayTransportError("Evidence Gateway redirects are not permitted")


@dataclass(frozen=True)
class EvidenceGatewayFetchResult:
    response: EvidenceGatewayResponse | None
    etag: str | None
    not_modified: bool = False


def _headers_lower(headers: Mapping[str, str]) -> dict[str, str]:
    return {str(key).lower(): str(value) for key, value in headers.items()}


def package_release_hash(package_payload: Mapping[str, object]) -> str:
    """Match the public gateway's recursively key-sorted JSON SHA-256 contract."""

    serialized = json.dumps(
        package_payload,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
        allow_nan=False,
    ).encode("utf-8")
    return "sha256:" + hashlib.sha256(serialized).hexdigest()


def validate_gateway_http_document(
    document: Mapping[str, object],
    headers: Mapping[str, str],
    *,
    expected_county_fips: str,
) -> EvidenceGatewayResponse:
    if not expected_county_fips.isdigit() or len(expected_county_fips) != 5:
        raise EvidenceGatewayTransportError("expected county FIPS must be five digits")

    manifest_payload = document.get("manifest")
    package_payload = document.get("package")
    if not isinstance(manifest_payload, dict) or not isinstance(package_payload, dict):
        raise EvidenceGatewayTransportError("Evidence Gateway response envelope is invalid")

    try:
        response = EvidenceGatewayResponse.model_validate(document)
    except Exception as exc:  # pydantic error details are internal diagnostics
        raise EvidenceGatewayTransportError("Evidence Gateway contract validation failed") from exc

    release_hash = response.manifest.release_hash
    if not release_hash.startswith("sha256:") or len(release_hash) != 71:
        raise EvidenceGatewayTransportError("Evidence Gateway release hash is invalid")
    computed_hash = package_release_hash(package_payload)
    if computed_hash != release_hash:
        raise EvidenceGatewayTransportError("Evidence Gateway package hash mismatch")

    normalized_headers = _headers_lower(headers)
    contract_header = normalized_headers.get("x-evidence-contract")
    release_header = normalized_headers.get("x-evidence-release")
    hash_header = normalized_headers.get("x-evidence-release-hash")
    etag = normalized_headers.get("etag", "").strip('"')
    content_type = normalized_headers.get("content-type", "")

    if "application/json" not in content_type.lower():
        raise EvidenceGatewayTransportError("Evidence Gateway response is not JSON")
    if contract_header != SHARED_EVIDENCE_CONTRACT_VERSION:
        raise EvidenceGatewayTransportError("Evidence Gateway contract header mismatch")
    if release_header != response.manifest.release_id:
        raise EvidenceGatewayTransportError("Evidence Gateway release header mismatch")
    if hash_header != release_hash or etag != release_hash:
        raise EvidenceGatewayTransportError("Evidence Gateway release hash header mismatch")

    counties = [
        geography
        for geography in response.package.geographies
        if geography.kind.value == "county"
        and (
            geography.county_fips == expected_county_fips
            or geography.authority_id == expected_county_fips
        )
    ]
    if len(response.package.geographies) != 1 or len(counties) != 1:
        raise EvidenceGatewayTransportError(
            "Evidence Gateway county response crossed the requested geography boundary"
        )
    return response


class EvidenceGatewayHttpClient:
    def __init__(
        self,
        endpoint_url: str,
        *,
        timeout_seconds: float = 10.0,
        max_response_bytes: int = 10 * 1024 * 1024,
        user_agent: str = "cbcap-core/evidence-gateway-v1",
    ) -> None:
        parsed = urlsplit(endpoint_url)
        if parsed.scheme.lower() != "https":
            raise ValueError("Evidence Gateway endpoint must use HTTPS")
        if not parsed.hostname or parsed.username or parsed.password:
            raise ValueError("Evidence Gateway endpoint authority is invalid")
        if parsed.query or parsed.fragment:
            raise ValueError("Evidence Gateway endpoint must not include query or fragment")
        if not parsed.path.rstrip("/").endswith("/api/evidence/v1/gateway"):
            raise ValueError("Evidence Gateway endpoint path is invalid")
        if timeout_seconds <= 0:
            raise ValueError("timeout_seconds must be positive")
        if max_response_bytes < 1024:
            raise ValueError("max_response_bytes is too small")

        self._endpoint = urlunsplit(
            (parsed.scheme, parsed.netloc, parsed.path.rstrip("/"), "", "")
        )
        self._timeout_seconds = timeout_seconds
        self._max_response_bytes = max_response_bytes
        self._user_agent = user_agent
        self._opener = build_opener(_RejectRedirects())

    def fetch_county(
        self,
        county_fips: str,
        *,
        etag: str | None = None,
    ) -> EvidenceGatewayFetchResult:
        if not county_fips.isdigit() or len(county_fips) != 5:
            raise ValueError("county_fips must be five digits")

        request_headers = {
            "Accept": "application/json",
            "User-Agent": self._user_agent,
        }
        if etag:
            request_headers["If-None-Match"] = etag
        request = Request(
            f"{self._endpoint}?{urlencode({'geoid': county_fips})}",
            method="GET",
            headers=request_headers,
        )

        try:
            response = self._opener.open(request, timeout=self._timeout_seconds)
            status = int(getattr(response, "status", 200))
            headers = {key: value for key, value in response.headers.items()}
            if status != 200:
                raise EvidenceGatewayTransportError(
                    f"Evidence Gateway returned unexpected status {status}"
                )
            content_length = headers.get("Content-Length") or headers.get("content-length")
            if content_length and int(content_length) > self._max_response_bytes:
                raise EvidenceGatewayTransportError("Evidence Gateway response is too large")
            body = response.read(self._max_response_bytes + 1)
            if len(body) > self._max_response_bytes:
                raise EvidenceGatewayTransportError("Evidence Gateway response is too large")
        except HTTPError as exc:
            if exc.code == 304:
                return EvidenceGatewayFetchResult(
                    response=None,
                    etag=etag,
                    not_modified=True,
                )
            raise EvidenceGatewayTransportError(
                f"Evidence Gateway request failed with HTTP {exc.code}"
            ) from exc
        except (URLError, TimeoutError, OSError) as exc:
            raise EvidenceGatewayTransportError("Evidence Gateway request failed") from exc

        try:
            document = json.loads(
                body.decode("utf-8"),
                parse_constant=lambda value: (_ for _ in ()).throw(
                    ValueError(f"invalid JSON constant: {value}")
                ),
            )
        except (UnicodeDecodeError, json.JSONDecodeError, ValueError) as exc:
            raise EvidenceGatewayTransportError("Evidence Gateway returned invalid JSON") from exc
        if not isinstance(document, dict):
            raise EvidenceGatewayTransportError("Evidence Gateway response must be an object")

        validated = validate_gateway_http_document(
            document,
            headers,
            expected_county_fips=county_fips,
        )
        return EvidenceGatewayFetchResult(
            response=validated,
            etag=headers.get("ETag") or headers.get("etag"),
            not_modified=False,
        )

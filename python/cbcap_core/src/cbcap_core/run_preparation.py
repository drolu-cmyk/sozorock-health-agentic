from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from .evidence_adapter import select_county_public_evidence
from .gateway import EvidenceGatewayResponse
from .gateway_transport import EvidenceGatewayHttpClient
from .graph import CountyGraphContext, RunBudget
from .models import CountyRunState


class CountyRunPreparationError(RuntimeError):
    pass


@dataclass(frozen=True)
class PreparedCountyGraphRun:
    context: CountyGraphContext
    budget: RunBudget
    evidence_etag: str | None
    evidence_release_hash: str
    evidence_release_id: str
    external_calls_used: int = 1


def _validate_cached_response(
    run: CountyRunState,
    response: EvidenceGatewayResponse,
    *,
    etag: str | None,
) -> EvidenceGatewayResponse:
    select_county_public_evidence(run, response.package)
    if etag:
        normalized = etag.strip('"')
        if normalized != response.manifest.release_hash:
            raise CountyRunPreparationError(
                "cached Evidence Gateway response does not match the supplied ETag"
            )
    return response


def prepare_county_graph_run(
    run: CountyRunState,
    budget: RunBudget,
    client: EvidenceGatewayHttpClient,
    *,
    etag: str | None = None,
    cached_response: EvidenceGatewayResponse | None = None,
    planning_pipeline_request: dict[str, Any] | None = None,
) -> PreparedCountyGraphRun:
    county_fips = run.county.county_fips
    if county_fips is None or not county_fips.isdigit() or len(county_fips) != 5:
        raise CountyRunPreparationError(
            "county run must carry a valid five-digit county FIPS before evidence retrieval"
        )

    next_external_calls = budget.external_calls_used + 1
    next_preflight_calls = budget.preflight_external_calls_used + 1
    if next_external_calls > budget.max_external_calls:
        raise CountyRunPreparationError(
            "public evidence retrieval would exceed the run external-call budget"
        )

    fetched = client.fetch_county(county_fips, etag=etag)
    if fetched.not_modified:
        if cached_response is None:
            raise CountyRunPreparationError(
                "Evidence Gateway returned not-modified but no validated cached response was supplied"
            )
        response = _validate_cached_response(run, cached_response, etag=etag)
    else:
        if fetched.response is None:
            raise CountyRunPreparationError(
                "Evidence Gateway fetch completed without a validated response"
            )
        response = fetched.response
        select_county_public_evidence(run, response.package)

    updated_budget = RunBudget.model_validate(
        {
            **budget.model_dump(mode="python"),
            "preflight_external_calls_used": next_preflight_calls,
            "external_calls_used": next_external_calls,
        }
    )
    if updated_budget.exceeded():
        raise CountyRunPreparationError(
            "public evidence retrieval exceeded the configured run budget"
        )

    context = CountyGraphContext(
        public_evidence_package=response.package.model_dump(mode="json"),
        planning_pipeline_request=planning_pipeline_request,
    )
    return PreparedCountyGraphRun(
        context=context,
        budget=updated_budget,
        evidence_etag=fetched.etag or etag,
        evidence_release_hash=response.manifest.release_hash,
        evidence_release_id=response.manifest.release_id,
    )

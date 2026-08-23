from __future__ import annotations

from typing import Literal

from pydantic import Field

from .models import (
    CountyRunState,
    ReviewStatus,
    StrictModel,
    TenantVisibility,
)


EvidenceGraphNodeType = Literal[
    "geography",
    "source_version",
    "source_document",
    "evidence_claim",
    "measure",
    "barrier_observation",
    "barrier_pattern",
    "plan_document",
    "plan_priority",
    "organization",
    "funding_opportunity",
    "funding_fit",
    "scenario_assumption",
    "forecast",
    "review_decision",
    "publication_artifact",
]

EvidenceGraphRelationship = Literal[
    "source_version_applies_to_geography",
    "source_document_uses_source_version",
    "source_document_applies_to_geography",
    "claim_supported_by_source_document",
    "claim_applies_to_geography",
    "measure_uses_source_version",
    "measure_observed_in_geography",
    "barrier_supported_by_measure",
    "barrier_supported_by_claim",
    "barrier_pattern_contains_observation",
    "plan_supported_by_source_document",
    "plan_applies_to_geography",
    "priority_belongs_to_plan",
    "priority_applies_to_geography",
    "priority_supported_by_claim",
    "priority_measured_by",
    "priority_addresses_barrier",
    "priority_involves_organization",
    "organization_operates_in_geography",
    "funding_opportunity_supported_by_document",
    "funding_opportunity_applies_to_geography",
    "funding_fit_matches_opportunity",
    "funding_fit_applies_to_geography",
    "funding_fit_supports_priority",
    "funding_fit_addresses_barrier",
    "funding_fit_supported_by_claim",
    "scenario_applies_to_geography",
    "scenario_changes_measure",
    "scenario_supported_by_claim",
    "forecast_applies_to_geography",
    "forecast_projects_measure",
    "forecast_uses_assumption",
    "forecast_uses_input_measure",
    "review_decides_entity",
    "artifact_applies_to_geography",
    "artifact_uses_entity",
]

IntegritySeverity = Literal["information", "review_required", "blocking"]


class EvidenceGraphNode(StrictModel):
    id: str = Field(min_length=1)
    node_type: EvidenceGraphNodeType
    entity_id: str = Field(min_length=1)
    review_status: ReviewStatus | None = None
    visibility: TenantVisibility = TenantVisibility.PUBLIC
    tenant_id: str | None = None


class EvidenceGraphEdge(StrictModel):
    id: str = Field(min_length=1)
    relationship: EvidenceGraphRelationship
    from_node_id: str = Field(min_length=1)
    to_node_id: str = Field(min_length=1)
    provenance_entity_ids: list[str] = Field(default_factory=list)
    review_status: ReviewStatus | None = None
    authoritative: bool = False


class EvidenceGraphIntegrityIssue(StrictModel):
    id: str = Field(min_length=1)
    severity: IntegritySeverity
    code: str = Field(min_length=1)
    entity_ids: list[str] = Field(default_factory=list)
    message: str = Field(min_length=1)


class EvidenceGraphSnapshot(StrictModel):
    schema_version: Literal["cbcap.evidence-graph.v1"] = "cbcap.evidence-graph.v1"
    run_id: str = Field(min_length=1)
    tenant_id: str | None = None
    status: Literal["ready", "blocked"]
    nodes: list[EvidenceGraphNode] = Field(default_factory=list)
    edges: list[EvidenceGraphEdge] = Field(default_factory=list)
    integrity_issues: list[EvidenceGraphIntegrityIssue] = Field(default_factory=list)

    @property
    def authoritative_edges(self) -> list[EvidenceGraphEdge]:
        return [item for item in self.edges if item.authoritative]


def _node_id(node_type: EvidenceGraphNodeType, entity_id: str) -> str:
    return f"node:{node_type}:{entity_id}"


def _visibility(entity) -> TenantVisibility:
    return getattr(entity, "visibility", TenantVisibility.PUBLIC)


def _tenant_id(entity) -> str | None:
    return getattr(entity, "tenant_id", None)


def _review_status(entity) -> ReviewStatus | None:
    return getattr(entity, "review_status", None)


def _add_node(
    nodes: dict[str, EvidenceGraphNode],
    *,
    node_type: EvidenceGraphNodeType,
    entity_id: str,
    review_status: ReviewStatus | None = None,
    visibility: TenantVisibility = TenantVisibility.PUBLIC,
    tenant_id: str | None = None,
) -> str:
    node_id = _node_id(node_type, entity_id)
    nodes[node_id] = EvidenceGraphNode(
        id=node_id,
        node_type=node_type,
        entity_id=entity_id,
        review_status=review_status,
        visibility=visibility,
        tenant_id=tenant_id,
    )
    return node_id


def _add_entity_node(
    nodes: dict[str, EvidenceGraphNode],
    node_type: EvidenceGraphNodeType,
    entity,
) -> str:
    return _add_node(
        nodes,
        node_type=node_type,
        entity_id=entity.id,
        review_status=_review_status(entity),
        visibility=_visibility(entity),
        tenant_id=_tenant_id(entity),
    )


def _issue(
    issues: list[EvidenceGraphIntegrityIssue],
    *,
    run_id: str,
    code: str,
    entity_ids: list[str],
    message: str,
    severity: IntegritySeverity = "blocking",
) -> None:
    issue_id = f"integrity:{run_id}:{code}:{':'.join(sorted(entity_ids))}"
    if any(item.id == issue_id for item in issues):
        return
    issues.append(
        EvidenceGraphIntegrityIssue(
            id=issue_id,
            severity=severity,
            code=code,
            entity_ids=entity_ids,
            message=message,
        )
    )


def _add_edge(
    edges: dict[str, EvidenceGraphEdge],
    issues: list[EvidenceGraphIntegrityIssue],
    nodes: dict[str, EvidenceGraphNode],
    *,
    run_id: str,
    relationship: EvidenceGraphRelationship,
    from_node_id: str,
    to_node_id: str,
    provenance_entity_ids: list[str],
    review_status: ReviewStatus | None,
) -> None:
    missing = [node_id for node_id in (from_node_id, to_node_id) if node_id not in nodes]
    if missing:
        _issue(
            issues,
            run_id=run_id,
            code="relationship_reference_missing",
            entity_ids=[*provenance_entity_ids, *missing],
            message="Evidence graph relationship references an entity that is not present in canonical county state.",
        )
        return

    from_node = nodes[from_node_id]
    to_node = nodes[to_node_id]
    authoritative = (
        review_status == ReviewStatus.VERIFIED
        and from_node.review_status in {None, ReviewStatus.VERIFIED}
        and to_node.review_status in {None, ReviewStatus.VERIFIED}
    )
    edge_id = f"edge:{relationship}:{from_node_id}:{to_node_id}"
    edges[edge_id] = EvidenceGraphEdge(
        id=edge_id,
        relationship=relationship,
        from_node_id=from_node_id,
        to_node_id=to_node_id,
        provenance_entity_ids=provenance_entity_ids,
        review_status=review_status,
        authoritative=authoritative,
    )


def _validate_tenant_boundary(
    run: CountyRunState,
    nodes: dict[str, EvidenceGraphNode],
    issues: list[EvidenceGraphIntegrityIssue],
) -> None:
    for node in nodes.values():
        if node.visibility in {TenantVisibility.TENANT, TenantVisibility.RESTRICTED}:
            if run.tenant_id is None:
                _issue(
                    issues,
                    run_id=run.run_id,
                    code="tenant_state_without_run_tenant",
                    entity_ids=[node.entity_id],
                    message="Tenant or restricted evidence cannot enter a county run without tenant identity.",
                )
            elif node.tenant_id != run.tenant_id:
                _issue(
                    issues,
                    run_id=run.run_id,
                    code="cross_tenant_entity",
                    entity_ids=[node.entity_id, node.tenant_id or "missing", run.tenant_id],
                    message="Evidence graph contains an entity belonging to another tenant.",
                )


def build_evidence_graph(run: CountyRunState) -> EvidenceGraphSnapshot:
    """Build a deterministic evidence relationship layer over canonical county state.

    PostgreSQL remains authoritative storage. This snapshot is an explicit graph
    projection for reasoning, visualization and retrieval. Missing references and
    tenant violations block the graph rather than being silently dropped.
    """

    nodes: dict[str, EvidenceGraphNode] = {}
    edges: dict[str, EvidenceGraphEdge] = {}
    issues: list[EvidenceGraphIntegrityIssue] = []

    county_node = _add_entity_node(nodes, "geography", run.county)

    source_versions = {}
    for document in run.source_documents:
        source_versions[document.source_version.source_version_id] = document.source_version
    for measure in run.measures:
        source_versions[measure.source_version.source_version_id] = measure.source_version

    for source_version in source_versions.values():
        source_node = _add_node(
            nodes,
            node_type="source_version",
            entity_id=source_version.source_version_id,
            review_status=source_version.review_status,
        )
        _add_edge(
            edges,
            issues,
            nodes,
            run_id=run.run_id,
            relationship="source_version_applies_to_geography",
            from_node_id=source_node,
            to_node_id=county_node,
            provenance_entity_ids=[source_version.source_version_id],
            review_status=source_version.review_status,
        )

    for document in run.source_documents:
        document_node = _add_entity_node(nodes, "source_document", document)
        source_node = _node_id("source_version", document.source_version.source_version_id)
        _add_edge(
            edges,
            issues,
            nodes,
            run_id=run.run_id,
            relationship="source_document_uses_source_version",
            from_node_id=document_node,
            to_node_id=source_node,
            provenance_entity_ids=[document.id],
            review_status=document.review_status,
        )
        for geography_id in document.geography_ids:
            target = county_node if geography_id == run.county.id else _node_id("geography", geography_id)
            _add_edge(
                edges,
                issues,
                nodes,
                run_id=run.run_id,
                relationship="source_document_applies_to_geography",
                from_node_id=document_node,
                to_node_id=target,
                provenance_entity_ids=[document.id],
                review_status=document.review_status,
            )

    for claim in run.evidence_claims:
        claim_node = _add_entity_node(nodes, "evidence_claim", claim)
        _add_edge(
            edges,
            issues,
            nodes,
            run_id=run.run_id,
            relationship="claim_supported_by_source_document",
            from_node_id=claim_node,
            to_node_id=_node_id("source_document", claim.source_document_id),
            provenance_entity_ids=[claim.id],
            review_status=claim.review_status,
        )
        for geography_id in claim.geography_ids:
            target = county_node if geography_id == run.county.id else _node_id("geography", geography_id)
            _add_edge(
                edges,
                issues,
                nodes,
                run_id=run.run_id,
                relationship="claim_applies_to_geography",
                from_node_id=claim_node,
                to_node_id=target,
                provenance_entity_ids=[claim.id],
                review_status=claim.review_status,
            )

    for measure in run.measures:
        measure_node = _add_entity_node(nodes, "measure", measure)
        _add_edge(
            edges,
            issues,
            nodes,
            run_id=run.run_id,
            relationship="measure_uses_source_version",
            from_node_id=measure_node,
            to_node_id=_node_id("source_version", measure.source_version.source_version_id),
            provenance_entity_ids=[measure.id],
            review_status=measure.review_status,
        )
        target = county_node if measure.geography.id == run.county.id else _node_id("geography", measure.geography.id)
        _add_edge(
            edges,
            issues,
            nodes,
            run_id=run.run_id,
            relationship="measure_observed_in_geography",
            from_node_id=measure_node,
            to_node_id=target,
            provenance_entity_ids=[measure.id],
            review_status=measure.review_status,
        )

    for barrier in run.barrier_observations:
        barrier_node = _add_entity_node(nodes, "barrier_observation", barrier)
        _add_edge(
            edges,
            issues,
            nodes,
            run_id=run.run_id,
            relationship="barrier_supported_by_measure",
            from_node_id=barrier_node,
            to_node_id=_node_id("measure", barrier.measure_id),
            provenance_entity_ids=[barrier.id],
            review_status=barrier.review_status,
        )
        for claim_id in barrier.evidence_claim_ids:
            _add_edge(
                edges,
                issues,
                nodes,
                run_id=run.run_id,
                relationship="barrier_supported_by_claim",
                from_node_id=barrier_node,
                to_node_id=_node_id("evidence_claim", claim_id),
                provenance_entity_ids=[barrier.id],
                review_status=barrier.review_status,
            )

    for pattern in run.barrier_patterns:
        pattern_node = _add_entity_node(nodes, "barrier_pattern", pattern)
        for observation_id in pattern.observation_ids:
            _add_edge(
                edges,
                issues,
                nodes,
                run_id=run.run_id,
                relationship="barrier_pattern_contains_observation",
                from_node_id=pattern_node,
                to_node_id=_node_id("barrier_observation", observation_id),
                provenance_entity_ids=[pattern.id],
                review_status=pattern.review_status,
            )

    for plan in run.plan_documents:
        plan_node = _add_entity_node(nodes, "plan_document", plan)
        _add_edge(
            edges,
            issues,
            nodes,
            run_id=run.run_id,
            relationship="plan_supported_by_source_document",
            from_node_id=plan_node,
            to_node_id=_node_id("source_document", plan.source_document_id),
            provenance_entity_ids=[plan.id],
            review_status=plan.review_status,
        )
        for geography_id in plan.geography_ids:
            target = county_node if geography_id == run.county.id else _node_id("geography", geography_id)
            _add_edge(
                edges,
                issues,
                nodes,
                run_id=run.run_id,
                relationship="plan_applies_to_geography",
                from_node_id=plan_node,
                to_node_id=target,
                provenance_entity_ids=[plan.id],
                review_status=plan.review_status,
            )

    for organization in run.organizations:
        organization_node = _add_entity_node(nodes, "organization", organization)
        for geography_id in organization.geography_ids:
            target = county_node if geography_id == run.county.id else _node_id("geography", geography_id)
            _add_edge(
                edges,
                issues,
                nodes,
                run_id=run.run_id,
                relationship="organization_operates_in_geography",
                from_node_id=organization_node,
                to_node_id=target,
                provenance_entity_ids=[organization.id],
                review_status=ReviewStatus.VERIFIED,
            )

    for priority in run.plan_priorities:
        priority_node = _add_entity_node(nodes, "plan_priority", priority)
        _add_edge(
            edges,
            issues,
            nodes,
            run_id=run.run_id,
            relationship="priority_belongs_to_plan",
            from_node_id=priority_node,
            to_node_id=_node_id("plan_document", priority.plan_document_id),
            provenance_entity_ids=[priority.id],
            review_status=priority.review_status,
        )
        for geography_id in priority.geography_ids:
            target = county_node if geography_id == run.county.id else _node_id("geography", geography_id)
            _add_edge(
                edges,
                issues,
                nodes,
                run_id=run.run_id,
                relationship="priority_applies_to_geography",
                from_node_id=priority_node,
                to_node_id=target,
                provenance_entity_ids=[priority.id],
                review_status=priority.review_status,
            )
        for claim_id in priority.evidence_claim_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="priority_supported_by_claim", from_node_id=priority_node, to_node_id=_node_id("evidence_claim", claim_id), provenance_entity_ids=[priority.id], review_status=priority.review_status)
        for measure_id in priority.measure_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="priority_measured_by", from_node_id=priority_node, to_node_id=_node_id("measure", measure_id), provenance_entity_ids=[priority.id], review_status=priority.review_status)
        for barrier_id in priority.barrier_observation_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="priority_addresses_barrier", from_node_id=priority_node, to_node_id=_node_id("barrier_observation", barrier_id), provenance_entity_ids=[priority.id], review_status=priority.review_status)
        for organization_id in priority.organization_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="priority_involves_organization", from_node_id=priority_node, to_node_id=_node_id("organization", organization_id), provenance_entity_ids=[priority.id], review_status=priority.review_status)

    for opportunity in run.funding_opportunities:
        opportunity_node = _add_entity_node(nodes, "funding_opportunity", opportunity)
        _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="funding_opportunity_supported_by_document", from_node_id=opportunity_node, to_node_id=_node_id("source_document", opportunity.source_document_id), provenance_entity_ids=[opportunity.id], review_status=opportunity.review_status)
        for geography_id in opportunity.geography_ids:
            target = county_node if geography_id == run.county.id else _node_id("geography", geography_id)
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="funding_opportunity_applies_to_geography", from_node_id=opportunity_node, to_node_id=target, provenance_entity_ids=[opportunity.id], review_status=opportunity.review_status)

    for fit in run.funding_fits:
        fit_node = _add_entity_node(nodes, "funding_fit", fit)
        _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="funding_fit_matches_opportunity", from_node_id=fit_node, to_node_id=_node_id("funding_opportunity", fit.opportunity_id), provenance_entity_ids=[fit.id], review_status=fit.review_status)
        target = county_node if fit.geography_id == run.county.id else _node_id("geography", fit.geography_id)
        _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="funding_fit_applies_to_geography", from_node_id=fit_node, to_node_id=target, provenance_entity_ids=[fit.id], review_status=fit.review_status)
        for priority_id in fit.plan_priority_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="funding_fit_supports_priority", from_node_id=fit_node, to_node_id=_node_id("plan_priority", priority_id), provenance_entity_ids=[fit.id], review_status=fit.review_status)
        for barrier_id in fit.barrier_observation_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="funding_fit_addresses_barrier", from_node_id=fit_node, to_node_id=_node_id("barrier_observation", barrier_id), provenance_entity_ids=[fit.id], review_status=fit.review_status)
        for claim_id in [*fit.designation_evidence_claim_ids, *fit.supporting_evidence_claim_ids]:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="funding_fit_supported_by_claim", from_node_id=fit_node, to_node_id=_node_id("evidence_claim", claim_id), provenance_entity_ids=[fit.id], review_status=fit.review_status)

    for assumption in run.scenario_assumptions:
        assumption_node = _add_entity_node(nodes, "scenario_assumption", assumption)
        target = county_node if assumption.geography_id == run.county.id else _node_id("geography", assumption.geography_id)
        _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="scenario_applies_to_geography", from_node_id=assumption_node, to_node_id=target, provenance_entity_ids=[assumption.id], review_status=None)
        measure_target = _node_id("measure", assumption.measure_id)
        if measure_target not in nodes:
            matching_semantic_measures = [item for item in run.measures if item.semantics.id == assumption.measure_id]
            if len(matching_semantic_measures) == 1:
                measure_target = _node_id("measure", matching_semantic_measures[0].id)
        _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="scenario_changes_measure", from_node_id=assumption_node, to_node_id=measure_target, provenance_entity_ids=[assumption.id], review_status=None)
        for claim_id in assumption.evidence_claim_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="scenario_supported_by_claim", from_node_id=assumption_node, to_node_id=_node_id("evidence_claim", claim_id), provenance_entity_ids=[assumption.id], review_status=None)

    for forecast in run.forecasts:
        forecast_node = _add_entity_node(nodes, "forecast", forecast)
        target = county_node if forecast.geography_id == run.county.id else _node_id("geography", forecast.geography_id)
        _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="forecast_applies_to_geography", from_node_id=forecast_node, to_node_id=target, provenance_entity_ids=[forecast.id], review_status=forecast.review_status)
        _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="forecast_projects_measure", from_node_id=forecast_node, to_node_id=_node_id("measure", forecast.measure_id), provenance_entity_ids=[forecast.id], review_status=forecast.review_status)
        for assumption_id in forecast.assumption_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="forecast_uses_assumption", from_node_id=forecast_node, to_node_id=_node_id("scenario_assumption", assumption_id), provenance_entity_ids=[forecast.id], review_status=forecast.review_status)
        for measure_id in forecast.input_measure_ids:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="forecast_uses_input_measure", from_node_id=forecast_node, to_node_id=_node_id("measure", measure_id), provenance_entity_ids=[forecast.id], review_status=forecast.review_status)

    for review in run.reviews:
        review_node = _add_entity_node(nodes, "review_decision", review)
        candidate_targets = [
            node_id for node_id, node in nodes.items() if node.entity_id == review.entity_id
        ]
        if len(candidate_targets) == 1:
            _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="review_decides_entity", from_node_id=review_node, to_node_id=candidate_targets[0], provenance_entity_ids=[review.id], review_status=ReviewStatus.VERIFIED)
        else:
            _issue(
                issues,
                run_id=run.run_id,
                code="review_target_unresolved",
                entity_ids=[review.id, review.entity_id],
                message="Review decision target could not be resolved uniquely in the evidence graph.",
            )

    for artifact in run.artifacts:
        artifact_node = _add_entity_node(nodes, "publication_artifact", artifact)
        target = county_node if artifact.geography_id == run.county.id else _node_id("geography", artifact.geography_id)
        _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="artifact_applies_to_geography", from_node_id=artifact_node, to_node_id=target, provenance_entity_ids=[artifact.id], review_status=ReviewStatus.VERIFIED if artifact.approval_decision_id else None)
        for entity_id in artifact.source_entity_ids:
            matches = [node_id for node_id, node in nodes.items() if node.entity_id == entity_id]
            if len(matches) == 1:
                _add_edge(edges, issues, nodes, run_id=run.run_id, relationship="artifact_uses_entity", from_node_id=artifact_node, to_node_id=matches[0], provenance_entity_ids=[artifact.id], review_status=ReviewStatus.VERIFIED if artifact.approval_decision_id else None)
            else:
                _issue(
                    issues,
                    run_id=run.run_id,
                    code="artifact_source_unresolved",
                    entity_ids=[artifact.id, entity_id],
                    message="Publication artifact source entity could not be resolved uniquely.",
                )

    _validate_tenant_boundary(run, nodes, issues)

    blocking = any(item.severity == "blocking" for item in issues)
    return EvidenceGraphSnapshot(
        run_id=run.run_id,
        tenant_id=run.tenant_id,
        status="blocked" if blocking else "ready",
        nodes=list(nodes.values()),
        edges=list(edges.values()),
        integrity_issues=issues,
    )

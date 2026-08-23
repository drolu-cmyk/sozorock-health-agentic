from __future__ import annotations

from .evidence_graph import (
    EvidenceGraphIntegrityIssue,
    EvidenceGraphNode,
    EvidenceGraphSnapshot,
    build_evidence_graph,
)
from .models import CountyRunState, TenantVisibility


TENANT_OWNED_NODE_TYPES = {
    "funding_fit",
    "scenario_assumption",
    "review_decision",
    "publication_artifact",
}


def _issue_id(run_id: str, code: str, entity_ids: list[str]) -> str:
    return f"integrity:{run_id}:{code}:{':'.join(sorted(entity_ids))}"


def _append_issue(
    issues: list[EvidenceGraphIntegrityIssue],
    *,
    run_id: str,
    code: str,
    entity_ids: list[str],
    message: str,
) -> None:
    issue_id = _issue_id(run_id, code, entity_ids)
    if any(item.id == issue_id for item in issues):
        return
    issues.append(
        EvidenceGraphIntegrityIssue(
            id=issue_id,
            severity="blocking",
            code=code,
            entity_ids=entity_ids,
            message=message,
        )
    )


def _normalize_node_visibility(node: EvidenceGraphNode) -> EvidenceGraphNode:
    if node.tenant_id is not None and node.node_type in TENANT_OWNED_NODE_TYPES:
        return node.model_copy(update={"visibility": TenantVisibility.TENANT})
    return node


def build_governed_evidence_graph(run: CountyRunState) -> EvidenceGraphSnapshot:
    """Apply tenant policy to the deterministic Evidence Graph projection.

    The raw graph builder is intentionally storage-oriented. This governed wrapper
    is the product-facing contract and must be used for retrieval, workspace views,
    exports and future MCP tools.
    """

    raw = build_evidence_graph(run)
    nodes = [_normalize_node_visibility(item) for item in raw.nodes]
    issues = list(raw.integrity_issues)

    for node in nodes:
        if node.tenant_id is not None:
            if run.tenant_id is None:
                _append_issue(
                    issues,
                    run_id=run.run_id,
                    code="tenant_owned_entity_without_run_tenant",
                    entity_ids=[node.entity_id, node.tenant_id],
                    message="Tenant-owned graph state cannot enter a county run without tenant identity.",
                )
            elif node.tenant_id != run.tenant_id:
                _append_issue(
                    issues,
                    run_id=run.run_id,
                    code="cross_tenant_entity",
                    entity_ids=[node.entity_id, node.tenant_id, run.tenant_id],
                    message="Evidence graph contains an entity owned by a different tenant.",
                )
        elif node.visibility in {TenantVisibility.TENANT, TenantVisibility.RESTRICTED}:
            _append_issue(
                issues,
                run_id=run.run_id,
                code="tenant_visibility_without_owner",
                entity_ids=[node.entity_id],
                message="Tenant or restricted graph data must carry an owning tenant identifier.",
            )

    blocked = any(item.severity == "blocking" for item in issues)
    return EvidenceGraphSnapshot(
        run_id=raw.run_id,
        tenant_id=raw.tenant_id,
        status="blocked" if blocked else "ready",
        nodes=nodes,
        edges=raw.edges,
        integrity_issues=issues,
    )

# CB-CAP Workspace and Institutional Memory API

All routes below are institutional, tenant scoped, authenticated, `Cache-Control: no-store`, and unavailable unless the institutional gateway has durable workspace and institutional-memory stores configured.

## Workspace collaboration

### `GET /api/cbcap/workspaces/:workspaceId/items`

Reads workspace collaboration state for the authenticated tenant. Optional query parameter: `status`.

### `POST /api/cbcap/workspaces/:workspaceId/items`

Creates one collaboration item. Supported `itemType` values are `draft`, `comment`, `task`, `saved_view`, and `review_question`. Requires a human owner or contributor in a planning role.

### `PUT /api/cbcap/workspaces/:workspaceId/items/:itemId`

Updates title, content, or status. Request body requires:

```json
{
  "expectedVersion": 3,
  "patch": {
    "status": "completed"
  }
}
```

A stale `expectedVersion` returns HTTP 409. The service does not silently overwrite another collaborator's change.

## Institutional memory

### `POST /api/cbcap/memory/query`

Returns reviewed active institutional memory by default. Optional filters include geography, decision type, subject, and `asOf`.

`includeProposed`, `includeRejected`, and `includeExpired` are privileged review/history views and require institutional review authority.

### `POST /api/cbcap/memory/proposals`

Proposes an institutional memory record. A proposal is not active institutional knowledge. The record requires evidence IDs, reason codes, rationale, scope, subject, outcome, and applicability. Every evidence ID is revalidated before the proposal is stored.

### `POST /api/cbcap/memory/proposals/:proposalId/review`

Requires foundation-reviewer or county-planner authority with owner/contributor access.

```json
{
  "decision": "approve",
  "rationale": "Evidence and scope were reviewed."
}
```

Before approval, the system revalidates the proposal's evidence. Approval fails closed if evidence is no longer verified.

### `POST /api/cbcap/memory/:memoryId/supersede`

Supersedes a reviewed memory record by creating a new immutable supersession record. The old record is retained in history.

```json
{
  "reasonCodes": ["newer_evidence_release"],
  "rationale": "A newer reviewed release changes the institutional interpretation."
}
```

## Status semantics

Workspace writes use optimistic versions. Institutional memory uses append-only lifecycle records:

`proposed -> reviewed | rejected`

A reviewed record may later receive one immutable supersession record. Database constraints prevent duplicate reviews and duplicate supersessions.

## Non-negotiable boundaries

- Tenant identity comes from authenticated workspace claims, never the memory payload.
- Workspace content is collaboration state, not institutional truth.
- Evidence-agent actors may read reviewed memory but cannot propose, approve, reject, or supersede it.
- No client can directly create a `reviewed` institutional-memory row.
- Ordinary chat, model output, comments, drafts, and saved views are never promoted automatically.

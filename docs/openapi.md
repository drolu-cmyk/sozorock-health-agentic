# API contract

The canonical machine-readable contract is [`openapi.yaml`](openapi.yaml).

The old unauthenticated `/place` prototype and its synthetic barrier scores, hub rankings, reach estimates, and browser sessions are retired. `POST /api/place` returns `410 Gone` and points clients to the governed `/api/cbcap` workflow. Institutional CB-CAP routes require authenticated workspace identity unless the explicit development-only planning override is enabled.

Audit state is not exposed through a public endpoint. Governed run, review, workspace, institutional, monitoring, and learning records use their documented append-only persistence contracts.

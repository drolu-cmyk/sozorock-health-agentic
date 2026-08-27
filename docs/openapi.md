# API contract

The canonical machine-readable contract is [`openapi.yaml`](openapi.yaml).

The old unauthenticated `/place` prototype and its synthetic barrier scores, hub rankings, reach estimates, and browser sessions are retired. `POST /api/place` returns `410 Gone` and points clients to the governed `/api/cbcap` workflow. Institutional CB-CAP routes require authenticated workspace identity unless the explicit development-only planning override is enabled.

Audit state is not exposed through a public endpoint. Governed run, review, workspace, institutional, monitoring, and learning records use their documented append-only persistence contracts.

The implemented institutional surface also includes governed visualization workspaces, county workforce-capacity evidence, request-driven monitoring evaluation, and tenant-private evidence metadata submission/review/query. Production model and evidence providers are selected only after authenticated tenant scope is established. Workforce, visualization, and institutional-evidence validation use the reviewed Evidence Gateway. Scenario, funding, and monitoring routes fail closed unless their server-owned reviewed provider records are configured; repository code does not fabricate registrations, opportunities, applicant profiles, monitor definitions, or baselines.

Tenant-private evidence upload initiation is intentionally unavailable. No endpoint issues a presigned URL. `POST /api/cbcap/private-evidence/submissions` only finalizes governance metadata for an object already staged through an externally governed process. The object must resolve to the authenticated tenant partition and pass version, SHA-256, KMS-key, media-type, and security-scan checks before it can enter human review.

The production edge exposes `/healthz`, `/readyz`, and the non-sensitive `/api/health` capability manifest. It otherwise preserves an API-only `/api/cbcap` boundary; `/`, legacy `/api/place`, and non-CB-CAP application routes are not exposed by the production wrapper.

The browser client authenticates through the Cognito Hosted UI with OAuth authorization-code plus PKCE; implicit grant is not enabled and the client has no secret. The exact production callback is `https://cbcap.sozorockfoundation.org/auth/callback`, and the exact logout return is `https://cbcap.sozorockfoundation.org/`. Deployment stack outputs and the nonsecret `ui-runtime-config.json` artifact provide the API origin, AWS Region, user-pool ID, app-client ID, Hosted UI domain, callback, logout, and flow identifier required by the UI.

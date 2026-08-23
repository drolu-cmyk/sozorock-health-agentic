# CB-CAP AWS Deployment Direction

Status: target architecture baseline for the private CB-CAP product

## Product surfaces

The public SozoRock Health and Explore surfaces remain separate from the private CB-CAP planning runtime.

CB-CAP is no longer designed as a stateless single-function agent service. Its execution graphs require durable workflow state, source lineage, organization state, review decisions, audit events and resumable research runs.

## Web application

Recommended production shape:

- CloudFront for edge delivery and web protection
- S3 for immutable/public-safe static assets where appropriate
- private CB-CAP application/API behind authenticated HTTPS endpoints
- AWS WAF and rate controls at the public edge

The CB-CAP web application must not expose database credentials, provider secrets, tenant-private evidence or internal agent traces to the browser.

## Agent and graph runtime

Preferred runtime:

- Python CB-CAP graph workers in ECS/Fargate or another controlled container runtime
- API Gateway or an authenticated application service for run submission and status APIs
- SQS for bounded work queues and failure isolation as national fan-out is introduced
- EventBridge for scheduled evidence-refresh triggers

Lambda can remain appropriate for small stateless adapters, event handlers and short deterministic transformations. Long-running/resumable research graphs should not depend on Lambda process lifetime.

## Durable state

Target relational state:

- PostgreSQL-compatible AWS database, preferably managed RDS/Aurora where operationally justified
- PostGIS for authoritative geospatial relationships and queries
- LangGraph PostgreSQL checkpointer for workflow checkpoints
- application tables for evidence, planning relationships, organization state, review/audit records and product memory

The graph's in-memory checkpointer is restricted to local development and tests.

Production checkpoint requirements:

- `CB_CAP_CHECKPOINT_DATABASE_URL` supplied through runtime secrets/configuration, never committed
- TLS required by default (`sslmode=require`, `verify-ca`, or `verify-full`)
- `LANGGRAPH_STRICT_MSGPACK=true`
- application-level checkpoint encryption enabled by default using `LANGGRAPH_AES_KEY`
- database encryption at rest and backup encryption enabled in AWS
- least-privilege database identity for graph workers
- explicit checkpoint schema setup during controlled deployment, not silently on every application startup

## Evidence vault

Source artifacts such as approved public planning PDFs should be stored as immutable/versioned objects in S3 with:

- source identity
- retrieval timestamp
- content hash
- content type
- original URL
- object version
- retention policy

Public documents remain untrusted inputs. Parsed text must not be treated as executable graph instructions.

## Shared Evidence Gateway

CB-CAP consumes public facts from the versioned SozoRock Evidence Gateway contract rather than importing implementation code from the public Explore repository.

The gateway contains public geography, source versions, metric semantics and observations. It does not contain tenant IDs, organization-private evidence, funding-fit decisions, review notes or agent trajectories.

## Security and governance

Minimum runtime controls:

- least privilege IAM
- Secrets Manager or equivalent managed secret storage
- KMS-backed encryption for AWS resources where supported
- private networking for databases
- explicit outbound access policy for research workers
- source-host allowlists for controlled planning-document acquisition
- typed inter-agent handoffs
- tenant isolation
- append-only audit events for material autonomous actions
- per-run model, external-call and cost budgets
- kill switches and run cancellation
- model and agent version recording when model calls occur

## Cost posture

The default graph path is code-first and can execute with zero model tokens. Model calls are reserved for semantic work that deterministic code cannot perform reliably.

Scale should follow demonstrated workload:

1. controlled evaluation counties
2. paid design-partner workspaces
3. queued multi-county portfolios
4. national incremental refresh

Do not provision permanent autonomous workers per county. National operation should use bounded jobs, concurrency controls and incremental change detection.

# Superseded Draft Migration Record

Draft pull request #2, `Build CB-CAP governed planning intelligence foundation`, contains an earlier Python/FastAPI/ECS architecture. It is intentionally not a release branch and must not be merged wholesale into the Node control plane.

The reusable product and governance rules have been selectively migrated into the current runtime instead of preserving two competing execution architectures.

## Capability migration

| Earlier draft area | Current Node control-plane authority |
| --- | --- |
| Tenant identity and authorization | Cognito-compatible workspace identity, permission policy, actor-scoped tenant runtime |
| Graph execution | Governed CB-CAP graph, harness, kill switches, exact-run checkpoints |
| Run persistence | `agent_runs` and append-only `agent_run_events` with forced RLS |
| Local CHA/CHIP evidence | Evidence Gateway planning extension and governed workbench |
| Funding fit | Governed Funding Intelligence with server-owned criteria/profile |
| Visualization | `cbcap.visualization.v1` analytical specification layer |
| Scenario/forecasting | `cbcap.scenario.v1` reviewed deterministic scenario registrations |
| Workforce capacity | `cbcap.workforce-capacity.v1` HPSA/AHRF context without synthetic ranking |
| Workspace collaboration | Versioned workspace memory plus append-only events |
| Institutional memory | Human-reviewed proposal/review/supersession records |
| Learning/evaluation | Separate append-only trajectory/evaluation/correction/candidate domain |
| Monitoring | Governed monitor definitions/snapshots and append-only findings |
| Tenant-private evidence | `cbcap.tenant-private-evidence.v1` with server-resolved storage, rights, retention, review, and forced RLS |
| PostgreSQL isolation | Transaction-local `app.tenant_id`, forced RLS, same-tenant integrity, least-privilege production gate |
| Release/deployment hardening | `cbcap.production-readiness.v1` deployment, database, identity, recovery, observability, evidence, and rollback proofs |

## Deployment safeguards retained

The earlier deployment workflow included safeguards that remain valid independent of its old runtime implementation. These have been preserved as mandatory deployment proof rather than copied as Python/ECS-specific infrastructure:

- GitHub OIDC or equivalent short-lived deployment identity;
- explicit AWS account/region verification;
- release only from the exact protected main SHA;
- immutable runtime artifact identity;
- release-blocking vulnerability scan policy;
- managed secrets;
- private database/network path;
- KMS-encrypted versioned tenant-private evidence storage with public access blocked;
- migrations before user traffic;
- fail-closed staging before service enablement;
- TLS and edge protection;
- live security-header, CORS, and unauthenticated-route probes;
- backup and completed restore proof;
- observable logs/audit/alerts/incident route;
- deterministic rollback to a last known-good immutable release while public Explore and the Evidence Gateway remain independent.

See `docs/PRODUCTION_ACTIVATION.md`.

## What is intentionally not migrated

The following are not adopted from draft PR #2 merely because they exist there:

- a second FastAPI application runtime;
- Python copies of graph, policy, evidence, memory, or specialist-capability logic;
- a second evidence warehouse or public-data ingestion authority;
- synthetic scores, demo fallbacks, fixture-derived production conclusions, or client-defined formulas;
- CloudFormation/ECS resources whose assumptions are tied to the superseded Python runtime rather than the current Node deployment contract;
- a deployment workflow that could turn on institutional traffic before the current production-readiness gate passes.

If a future AWS implementation uses ECS, Lambda, App Runner, containers, or another compute substrate, that is an environment choice. It must satisfy the current Node runtime and `cbcap.production-readiness.v1`; infrastructure must not redefine product authority.

## Archive decision

Once the deployment-hardening contract is merged, draft PR #2 can be closed as superseded. The branch may remain as historical source material, but it is not an alternative production path and should not receive new product work.

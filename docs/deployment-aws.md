# CB-CAP private AWS deployment

Status: executable release contract for the private CB-CAP runtime. The existing `cbcap.sozorockfoundation.org` frontend is not replaced by this release.

## Product boundary

The public SozoRock Health and Explore surfaces remain separate from the private CB-CAP runtime.

Public evidence is consumed only through the governed Evidence Gateway at:

`https://health.sozorockfoundation.org/api/evidence/v1/gateway`

The first private runtime endpoint is intentionally separate:

`https://api.cbcap.sozorockfoundation.org`

This allows the governed API to be migrated, tested and secured before any paid workspace frontend cutover.

## Runtime package

`Dockerfile.runtime` packages only the governed Python runtime and SQL migrations required by the controlled migration task.

The image:

- runs as nonroot UID/GID `10001`
- contains `/app/sql` so the migration runner cannot depend on repository files outside the image
- installs the `production` dependency set
- starts `cbcap_core.runtime_bootstrap`
- exposes only port `8080`
- has a local `/healthz` container health check

`.dockerignore` excludes the old Node prototype, public assets, tests and local artifacts, while deliberately retaining `sql`.

## AWS stacks

### Registry

`infrastructure/cloudformation/cbcap-runtime-registry.yml`

Creates the dedicated ECR repository `sozorock/cbcap-runtime` with immutable image tags, scan on push, encryption and a bounded lifecycle policy.

### Private runtime

`infrastructure/cloudformation/cbcap-private-runtime.yml`

Creates the first controlled private runtime boundary:

- dedicated VPC
- public ALB subnets for the controlled API edge
- isolated PostgreSQL subnets
- security groups that restrict database ingress to the runtime tasks
- encrypted RDS PostgreSQL with managed master credentials, backups and deletion protection
- separate runtime database password in Secrets Manager
- encrypted LangGraph checkpoint key in Secrets Manager
- versioned KMS encrypted S3 storage for tenant private evidence
- Amazon Cognito user pool and application client
- ECS/Fargate runtime and migration task definitions
- CloudWatch runtime logs and container insights
- ACM managed TLS for `api.cbcap.sozorockfoundation.org`
- AWS WAF managed rules and per IP rate control
- Route53 alias for the private API

The stack defaults to `DesiredCount=0`. Creating infrastructure is therefore not equivalent to serving the runtime.

## Migration boundary

`cbcap_core.migration_runner` is a deployment task, not an application startup side effect.

It:

1. validates contiguous numbered SQL migrations beginning at `001`
2. records an immutable migration name and SHA256 ledger
3. refuses changed content for an already applied migration
4. creates or rotates the least privilege `cbcap_runtime` PostgreSQL role
5. grants only the required CB-CAP table access
6. creates the LangGraph checkpoint schema under the migration identity
7. grants checkpoint access to the runtime role

The runtime service is not scaled above zero until the migration task exits successfully.

## Deployment identity

`infrastructure/cloudformation/cbcap-private-deployment-bootstrap.yml` is a one time administrator bootstrap.

It creates two separate roles:

- `cbcap-private-github-deploy`, assumed only through GitHub OIDC for `drolu-cmyk/sozorock-health-agentic` and the `production` environment
- `cbcap-private-cloudformation`, assumed only by CloudFormation to create the approved CB-CAP resources

The GitHub role can deploy only stacks beginning with `cbcap-private-`, push and scan only the CB-CAP runtime ECR repository, run only the CB-CAP migration task family and pass only the CloudFormation or runtime task roles required for those operations.

The CloudFormation role can manage IAM roles only when their names begin with `cbcap-private-runtime-`. It cannot alter either deployment bootstrap role.

After the one time bootstrap, set the following GitHub production environment variables to the stack outputs:

- `CBCAP_PRIVATE_AWS_DEPLOY_ROLE_ARN`
- `CBCAP_PRIVATE_CLOUDFORMATION_ROLE_ARN`
- `AWS_REGION`, normally `us-east-1`

No AWS access key or secret key is stored in GitHub.

## Release workflow

`.github/workflows/deploy-private-runtime.yml` is manual and restricted to `main`.

It performs this sequence:

1. checks out the exact protected `main` source
2. runs the existing Node tests and the complete Python test suite
3. confirms the protected branch SHA has not moved
4. assumes the production OIDC role and verifies AWS account `791860731989`
5. creates or reconciles the immutable ECR repository
6. builds the runtime image and tags it with the exact Git commit SHA
7. blocks the release if ECR reports any high or critical finding
8. creates or updates the private runtime stack with `DesiredCount=0`
9. runs the migration Fargate task and requires exit code zero
10. updates the same stack to `DesiredCount=1`
11. waits for ECS service stability
12. proves `/healthz` and `/readyz`
13. proves an unauthenticated protected route returns `401`
14. reconfirms that protected `main` still points to the approved release SHA

The workflow cannot bypass failed tests, a failed vulnerability scan, a failed migration or an unhealthy service.

## Durable state

PostgreSQL is authoritative for CB-CAP workflow and decision state. The first runtime uses RDS PostgreSQL and the LangGraph PostgreSQL checkpointer.

Production persistence requirements remain fail closed:

- PostgreSQL only
- TLS required
- no SQLite or in memory production fallback
- `LANGGRAPH_STRICT_MSGPACK=true`
- encrypted checkpoints by default
- tenant RLS scoped database sessions
- append only decision, trajectory, review and operational evidence where defined by the schema

## Tenant private evidence

The private evidence bucket is not the public Evidence Gateway and is never used by Explore.

Private evidence requires:

- an object version
- KMS encryption
- public access block
- tenant partitioned object keys
- explicit usage rights
- aggregate nonclinical admission
- human review
- retention checks

PHI, person level health records and credentials or secrets are rejected by the application contract.

## Network posture

The database is isolated from the public internet. The first controlled runtime tasks use public subnets with public IP assignment solely to reach the public Evidence Gateway, Cognito JWKS, ECR, Secrets Manager and CloudWatch without introducing NAT gateway cost before validated workload exists. Runtime ingress is still limited to the ALB security group.

For multi tenant production scale, move runtime tasks to private subnets with controlled outbound egress or approved VPC endpoints where the destination supports them. This is a deliberate later hardening step, not a reason to place the database on a public network.

## Scale posture

The runtime begins with one task and code first execution that can use zero model tokens.

Scale should follow demonstrated workload:

1. five county evaluation
2. controlled design partner workspaces
3. queued multi county portfolios
4. incremental national refresh

Do not provision permanent workers per county. National operation should use bounded jobs, concurrency controls, change detection and explicit cost limits.

## Current external release gates

Repository side deployment code is present, but production must remain disabled until both external controls are satisfied:

1. GitHub hosted Actions execution for this private repository must be restored, or an approved isolated runner must be attached. Current failed runs terminate before checkout with no job steps or logs.
2. An AWS administrator must deploy the one time bootstrap stack and place its two output role ARNs in the GitHub `production` environment.

Neither condition should be bypassed by weakening CI, making the private repository public, committing static AWS credentials or deploying the old Node prototype as the new professional workspace.

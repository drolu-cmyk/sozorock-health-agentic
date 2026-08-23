# CB-CAP workspace membership administration

Status: production operator procedure for the private CB-CAP runtime

This workflow exists because authentication and authorization are intentionally separate.

Amazon Cognito proves who a person is. The CB-CAP membership ledger determines which tenant, county geographies and runtime role that verified principal may use. A Cognito account alone grants no CB-CAP workspace access.

There is no public membership administration endpoint. The production GitHub deployment role cannot grant or revoke memberships.

## Security boundary

Production membership administration uses the dedicated ECS task family `cbcap-membership-admin`.

The task:

- runs the same immutable, vulnerability-scanned runtime image as the API
- has no application task role
- receives only the RDS master credential through its dedicated ECS execution role
- connects to PostgreSQL over TLS
- writes one append-only `cbcap.workspace_membership_event`
- sets tenant RLS scope before reading or writing the ledger
- accepts only canonical county IDs such as `county:36001`
- stores the principal only as `principal:sha256:<digest>`
- never mutates a prior membership event
- treats reuse of a membership version with different content as an error

GitHub CI/CD may deploy the task definition but is deliberately unable to invoke it.

## Account creation

The production Cognito user pool is administrator-create-only and requires software-token MFA.

An AWS administrator creates the user through the Cognito administrative API or AWS console. Self-sign-up is disabled.

After the user exists, obtain the immutable Cognito `sub` and the exact issuer for the production user pool. Keep the raw `sub` in the administrator's local session only. Do not place it in GitHub variables, task overrides, application logs or tickets.

The runtime principal key is defined as:

`principal:sha256:` plus the lowercase SHA-256 hex digest of `issuer + NUL + subject` encoded as UTF-8.

The implementation in `cbcap_core.membership_admin` uses the same derivation as runtime authorization. Derive the opaque key locally, then use only that opaque key for production membership task overrides.

## Required stack outputs

From the `cbcap-private-runtime` stack obtain:

- `ClusterName`
- `MembershipAdminTaskDefinitionArn`
- `RuntimeSecurityGroupId`
- `PublicSubnetIds`
- `UserPoolId`

The membership task runs with no listening port. The runtime security group gives it database egress and no public inbound path.

## Grant event

Set one unique membership version for every immutable administrative event. Recommended format:

`membership:<tenant>:<yyyy-mm-dd>:<sequence>`

Required task override variables for a grant:

- `CB_CAP_MEMBERSHIP_PRINCIPAL_KEY`
- `CB_CAP_MEMBERSHIP_TENANT_ID`
- `CB_CAP_MEMBERSHIP_DECISION=granted`
- `CB_CAP_MEMBERSHIP_ROLE`
- `CB_CAP_MEMBERSHIP_GEOGRAPHY_IDS`
- `CB_CAP_MEMBERSHIP_VERSION`
- `CB_CAP_MEMBERSHIP_RECORDED_BY`

Optional:

- `CB_CAP_MEMBERSHIP_EXPIRES_AT`, an offset-aware ISO-8601 timestamp in the future

Allowed roles are `read_only`, `analyst`, `planner`, `reviewer`, and `admin`.

A grant requires at least one canonical county geography. Multiple counties are comma-separated and must be unique.

## Revoke event

Revocation is another append-only event. Do not update or delete the earlier grant.

Use a new membership version and set:

`CB_CAP_MEMBERSHIP_DECISION=revoked`

A revoke event may use an empty geography list because its purpose is to supersede the principal's prior active membership for the tenant.

## ECS execution pattern

Run the task through an AWS administrator identity, not the GitHub deployment role.

1. Read the runtime stack outputs.
2. Build an `awsvpc` network configuration using the stack public subnets, `RuntimeSecurityGroupId`, and `assignPublicIp=ENABLED` so the Fargate execution agent can retrieve the immutable image and injected secret.
3. Invoke `MembershipAdminTaskDefinitionArn` with launch type `FARGATE`.
4. Override only the `membership-admin` container's `CB_CAP_MEMBERSHIP_*` environment variables.
5. Wait for the task to stop.
6. Require container exit code `0`.
7. Record the task ARN, membership version and emitted opaque membership event ID in the administrative audit record.
8. If the task fails, inspect the `/sozorock/cbcap/runtime` CloudWatch log stream. Do not retry with a changed payload under the same membership version.

The task prints only the opaque membership event ID on success.

## Verification

After a grant:

1. Have the user complete Cognito sign-in and mandatory MFA.
2. Call the private CB-CAP API with the Cognito access token.
3. Confirm a county outside the membership geography set is rejected.
4. Confirm the permitted county can create a run.
5. Confirm the browser cannot submit a role, capability, canonical county state or membership record.

After a revoke, the next authorization attempt must fail even if the user's Cognito token has not yet expired. Membership is resolved from the server-owned ledger on each governed request.

## Prohibited shortcuts

Do not:

- enable Cognito self-sign-up to avoid the administrator workflow
- use Cognito groups as CB-CAP roles
- store the raw Cognito subject in the membership ledger
- add a public membership administration API
- allow the GitHub deployment role to invoke the membership administration task
- update or delete prior membership events
- reuse a membership version for changed content
- grant a tenant without explicit county scope
- bypass mandatory MFA for production workspace accounts

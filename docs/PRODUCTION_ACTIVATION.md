# Controlled Production Activation

CB-CAP institutional runtime activation is fail closed. Repository CI proves code contracts; it does not prove that a particular AWS account, Cognito user pool, PostgreSQL role, container image, backup, alarm, or deployment rollback is correct.

The runtime therefore has a separate target-environment gate: `cbcap.production-readiness.v1`.

## Run the gate

```bash
CB_CAP_PRODUCTION_READINESS_ADAPTER=/run/secrets/cbcap-readiness-adapter.js \
AGENTIC_ALLOWED_ORIGINS='https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org' \
AGENTIC_ALLOWED_HOSTS='api.cbcap.sozorockfoundation.org' \
AWS_REGION=us-east-1 \
npm run preflight:production
```

The adapter is deployment-owned and must export:

```js
exports.createReadinessOptions = async function createReadinessOptions() {
  return {
    pool,
    tenantA: 'preflight-tenant-a',
    tenantB: 'preflight-tenant-b',
    evidenceClient,
    identityProbe,
    deploymentProbe,
    recoveryProbe,
    observabilityProbe,
    rollbackProbe,
  };
};
```

Do not commit the production adapter, tokens, database credentials, AWS account identifiers, or secrets. The deployment layer should build the adapter from managed credentials and target-environment resources.

The command returns exit code `0` only when every section passes. A missing probe blocks activation rather than being treated as not applicable.

## Database gate

The gate inspects every tenant-protected table used by the current Node control plane:

- run registry and append-only run events;
- workspace items and append-only workspace events;
- institutional memory;
- learning trajectories, evaluations, corrections, candidates, and candidate reviews;
- monitoring findings;
- tenant-private evidence documents and reviews.

For each protected table it requires:

- row-level security enabled;
- row-level security forced;
- the reviewed tenant policy present;
- the reviewed append-only trigger present where required;
- the application runtime role is not the table owner;
- only the reviewed SELECT/INSERT/UPDATE privileges for that table;
- no DELETE, TRUNCATE, REFERENCES, or TRIGGER privilege;
- no superuser role;
- no `BYPASSRLS`;
- TLS on the live PostgreSQL connection.

The live isolation probe then uses a rollback-only workspace item to prove:

1. tenant A can see its own row;
2. tenant B cannot read the row;
3. tenant B cannot update the row;
4. tenant A's row is unchanged;
5. transaction-local `app.tenant_id` is cleared after rollback.

No probe row is committed.

## Evidence Gateway gate

The target runtime must successfully load the governed Evidence Gateway for the locked proof counties:

- Albany County, NY: `36001`
- Schenectady County, NY: `36093`
- Montgomery County, NY: `36057`
- Chester County, PA: `42029`
- Bexar County, TX: `48029`

The actor-side Evidence Gateway client already verifies package SHA256 identity. The activation gate additionally requires one consistent release ID across all five counties and the additive `sozorock.evidence-gateway.planning.v1` contract with planning document, claim, and citation arrays.

## Identity gate

The deployment adapter must run real Cognito/authorization probes and return all four as true:

- `claimsVerified`
- `sameTenantAuthorized`
- `crossTenantDenied`
- `humanReviewAuthorityVerified`

The probe should use non-production test workspaces or dedicated preflight identities. It must demonstrate that `custom:tenant_id`, `custom:workspace_role`, and `custom:workspace_access` are derived from the authenticated identity and that an agent/viewer cannot satisfy a human review gate.

## Deployment gate

The deployment probe preserves the security properties that matter from the superseded infrastructure draft without reintroducing its Python/FastAPI runtime. All of these must be independently true:

- `oidcIdentityVerified`: deployment used short-lived workload identity such as GitHub OIDC rather than stored AWS access keys;
- `deploymentAccountVerified`: the caller and target resources belong to the explicitly approved AWS account and region;
- `protectedMainShaVerified`: the artifact was built from the exact protected `main` commit authorized for release;
- `immutableImageVerified`: the runtime references an immutable container digest or equally immutable artifact identity rather than a mutable tag alone;
- `vulnerabilityScanClean`: the release artifact has no unresolved release-blocking high or critical findings under the approved scan policy;
- `managedSecretsVerified`: database credentials, Cognito secrets if any, signing material, and other credentials come from managed secret stores rather than repository or task-definition plaintext;
- `privateEvidenceStorageVerified`: tenant-private evidence storage has versioning, KMS encryption, public-access blocking, lifecycle/retention controls, and the expected tenant partition policy;
- `databaseNetworkIsolationVerified`: PostgreSQL is not publicly reachable and ingress is limited to the approved runtime/security path;
- `migrationsCompletedBeforeTraffic`: all reviewed migrations completed against the target database before new runtime traffic was enabled;
- `runtimeEnabledAfterMigrations`: the institutional service was staged with no user traffic or equivalent fail-closed state until migrations and preflight succeeded;
- `tlsCertificateVerified`: the production hostname serves the intended valid certificate and TLS configuration;
- `edgeProtectionVerified`: the approved host boundary, WAF/rate limiting or equivalent edge controls, and public ingress policy are active;
- `securityHeadersVerified`: live responses satisfy the approved HSTS, framing, content-type, referrer, permissions, CSP/API, and request-ID policy where applicable;
- `corsBoundaryVerified`: the live API accepts only reviewed SozoRock origins and denies untrusted preflights;
- `unauthenticatedProtectedRouteDenied`: protected institutional endpoints return an authentication/authorization denial without valid tenant identity.

The deployment probe must inspect the live target and release metadata. Setting these booleans from intended configuration without live evidence does not satisfy the purpose of the gate.

A recommended sequence is:

1. authenticate through OIDC and verify account/region;
2. build from the exact protected main SHA;
3. produce and scan an immutable artifact;
4. deploy infrastructure/runtime in a no-traffic or disabled state;
5. run migrations using a dedicated migration role;
6. run database, identity, evidence, storage, edge, and recovery probes;
7. enable institutional traffic only after the full production readiness report is green;
8. run live security/CORS/auth probes again;
9. preserve the exact release SHA/digest and preflight evidence for rollback/audit.

## Recovery gate

The deployment adapter must independently verify:

- `backupVerified`
- `restoreVerified`

A backup policy without a completed restore test is not enough. The adapter may include nonsecret evidence such as a restore test identifier or timestamp in the returned report.

## Observability gate

All four are required:

- `logsReachable`
- `auditEventsReachable`
- `alertsConfigured`
- `incidentRouteConfigured`

This proves that a private runtime failure can be detected and routed before the runtime is enabled for institutional users.

## Rollback gate

All three are required:

- `institutionalDisableVerified`
- `publicExploreUnaffected`
- `evidenceGatewayUnaffected`

CB-CAP must be able to disable or roll back the private institutional runtime without taking down the public Explore experience or corrupting the Evidence Gateway.

Rollback should restore the last known-good immutable runtime artifact. Database rollback must never be improvised with destructive reverse migrations; restore or forward-fix procedures must follow the reviewed recovery plan and preserve audit history.

## Configuration gate

Production activation is blocked when:

- `ENABLE_UNAUTHENTICATED_CBCAP_DEV=true`;
- `ENABLE_LEGACY_SESSIONS=true`;
- allowed origins are absent, wildcarded, or non-HTTPS;
- either the CB-CAP or SozoRock Health origin is absent;
- allowed production hosts are absent, wildcarded, or malformed;
- `AWS_REGION` is missing or malformed.

The deployment/edge layer must enforce the approved host list. A configured host list without live enforcement is insufficient; `edgeProtectionVerified` must also pass.

## Activation decision

`eligible_for_controlled_activation` means the inspected environment satisfies the coded gate at that moment. It is not a permanent certification. Any material identity, database, evidence, network, storage, backup, container, edge, or deployment change should run the gate again.

`blocked` means the institutional runtime must remain disabled. Public Explore and the Evidence Gateway remain independent of this decision.

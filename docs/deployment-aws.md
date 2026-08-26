# AWS deployment boundary

CB-CAP is a private institutional Node.js runtime, not a static public frontend or a
stateless public-data API. The public Explore application and Evidence Gateway are
owned by `drolu-cmyk/sozorock-health`; this repository consumes their versioned,
hash-verified evidence packages.

The target compute service may be ECS, Lambda, App Runner, or another approved AWS
service. That choice does not change the mandatory control plane:

- Node.js 24 or later and an immutable, vulnerability-scanned release artifact;
- GitHub OIDC or equivalent short-lived deployment identity;
- authenticated Cognito-compatible institutional identity before tenant selection;
- private PostgreSQL with TLS, transaction-local tenant context, forced RLS, and a
  least-privileged non-owner application role;
- KMS-encrypted, versioned, non-public tenant-private evidence storage;
- approved Host, CORS, TLS, WAF/rate-limit, security-header, and no-store controls;
- migrations and recovery verification before traffic;
- live Evidence Gateway, identity, database-isolation, observability, backup/restore,
  and rollback proofs.

Deploy the release with institutional traffic disabled. Build the deployment-owned
readiness adapter from managed target-environment credentials, then run:

```bash
CB_CAP_PRODUCTION_READINESS_ADAPTER=/run/secrets/cbcap-readiness-adapter.js \
AGENTIC_ALLOWED_ORIGINS='https://cbcap.sozorockfoundation.org;https://health.sozorockfoundation.org' \
AGENTIC_ALLOWED_HOSTS='api.cbcap.sozorockfoundation.org' \
AWS_REGION=us-east-1 \
npm run preflight:production
```

Enable traffic only when the exact deployed release returns
`eligible_for_controlled_activation`. Configuration booleans are not substitutes for
live probes, and the readiness gate must not be bypassed because a dependency is
pending.

The runtime rejects PHI, person-level records, credentials, and secrets at its
admission boundaries. Tenant-private institutional evidence is nevertheless durable,
tenant scoped, retention controlled, and never written into the public Evidence Core.

See [`PRODUCTION_ACTIVATION.md`](PRODUCTION_ACTIVATION.md) for the complete required
proof contract and activation order.

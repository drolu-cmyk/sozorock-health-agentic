# Tenant-Private Evidence

CB-CAP may use organization evidence that is not public, but private evidence is a separate authority domain from the public Evidence Gateway and from institutional memory.

## What the client can submit

A client may identify an opaque `uploadId` and provide governance metadata such as geography, document type, source label, sensitivity, rights basis, aggregation level, retention date, and explicit prohibited-data declarations.

A client cannot submit or choose the storage bucket, object key, object version, content hash, encryption key, public-access posture, or security-scan result. Those values must be resolved server-side for the authenticated tenant.

## Upload initiation boundary

The current runtime does not initiate uploads and does not issue presigned URLs. Its application IAM role is read-only for tenant-private objects, and the repository does not include a production malware-scanning ingestion pipeline. `POST /api/cbcap/private-evidence/submissions` is therefore a metadata-finalization endpoint for an opaque `uploadId` that was staged through a separately governed process; it is not an upload endpoint. Until a bounded uploader, content-length and media enforcement, KMS-only write policy, scan transition, expiry, and abandoned-upload cleanup are deployed and tested together, upload initiation remains explicitly disabled.

## Storage requirements

The runtime admits only objects that resolve to the authenticated tenant's opaque partition under `tenant-evidence/<tenant-hash>/...`.

Object metadata must establish:

- versioned storage;
- SHA256 content identity;
- positive byte length;
- KMS encryption;
- blocked public access;
- an allowed media type for normal review admission;
- a completed clean security scan for normal review admission.

Unsupported media or an incomplete/blocked security scan is quarantined. It is not silently treated as usable evidence.

## Prohibited data

The tenant-private evidence contract is not a PHI or person-level health-record store. A submission is rejected when it declares any of the following:

- person-level aggregation;
- protected health information;
- individual health records;
- credentials or secrets;
- missing usage rights;
- already-expired retention.

These rules are also enforced by the PostgreSQL schema for any record marked eligible for review.

## Human review

Submission does not authorize use. Eligible evidence requires an append-only human review by an authorized county planner or foundation reviewer with owner/contributor access.

The latest review controls use. A later rejection or needs-revision decision blocks an earlier acceptance without rewriting history. Expired evidence is blocked even if it was accepted earlier.

## What agents and clients can see

The tenant-only query surface returns sanitized reviewed metadata. It deliberately excludes:

- bucket names;
- storage keys;
- object-version identifiers;
- KMS key ARNs;
- raw document content.

An evidence agent may read reviewed, usable metadata for a tenant planning workflow, but cannot submit or review private evidence and gains no human approval authority.

## Public and institutional boundaries

Accepted tenant evidence remains private. Acceptance does not:

- add anything to the public Evidence Gateway;
- alter public Explore completeness;
- make a document public;
- promote a fact into institutional memory;
- approve a plan, funding decision, scenario, or allocation.

A separate governed human-reviewed workflow would be required for any future publication or institutional-memory promotion.

## Database isolation

`infrastructure/postgres/005_tenant_private_evidence.sql` creates append-only document and review tables with forced row-level security using transaction-local `app.tenant_id`. Reviews use a same-tenant composite foreign key so a review cannot be attached to a document in another tenant even through direct SQL.

The production application role must not own these tables and must not hold `BYPASSRLS`.

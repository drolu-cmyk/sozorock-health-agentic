# Permanent retirement of the RDS-backed institutional runtime

The owner's permanent RDS retirement instruction supersedes the earlier product-definition suspension. See the [Foundation decision record](https://drive.google.com/file/d/1QnaP_QEsIJxfLrga5r9DK_4PzNaDwSff/view) and the [Health reconciliation record](https://github.com/drolu-cmyk/sozorock-health/blob/main/docs/rds-retirement.md).

The production workflow remains disabled and no longer has OIDC or status-write permission. A release request explicitly fails instead of appearing successful because its only deployment job was skipped. The standalone shell entrypoint exits before reading AWS configuration, creating output directories, installing traps or invoking AWS. Its old snapshot/restore proof cannot run through that entrypoint. The historical CloudFormation runtime template has an unconditional rule that rejects every create or update, regardless of parameter overrides.

Historical implementation is retained for inspection. Local tests, migrations and authorization safeguards remain available; no production migration or recovery drill is authorized by their presence. Reintroducing RDS requires a new architectural decision and code review, not an environment-variable switch.

These are repository controls only. Live AWS inventory and billing were unavailable during the October 28, 2026 review. No resource deletion, backup removal, runtime shutdown or IAM policy installation is claimed. Before any live cleanup, verify the account, Regions, remaining resources, recovery points and dependencies. Do not run an old deployment revision as a cleanup tool.

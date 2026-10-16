# SozoRock Health Agentic

Software supporting evidence-based planning for SozoRock Health and the County-Based Community Access Platform (CB-CAP).

The platform helps teams organize public evidence, compare places, prepare planning briefs, and review proposed next steps. Source context and human judgment remain part of the planning process.

## Related products

- [SozoRock Health](https://health.sozorockfoundation.org/)
- [Place Intelligence](https://health.sozorockfoundation.org/explore)
- [CB-CAP](https://cbcap.sozorockfoundation.org/)
- [The SozoRock Foundation](https://www.sozorockfoundation.org/)

## Development

Node.js 24 or later is required.

```sh
npm ci --ignore-scripts
npm run lint
npm test
npm audit --omit=dev --audit-level=high
```

## Deployment suspension

The CB-CAP institutional runtime is inactive while the product is being defined. The `activate` job in `.github/workflows/deploy-production-runtime.yml` is unconditionally disabled, so a production release request cannot provision or activate the backend.

This guard does not stop previously running AWS resources. Database, compute, firewall, and public-address changes require separate operational verification. Public evidence is a separate deployment and must not be retired based on the institutional product's status.

Restore deployment only through a reviewed change after hosting is approved, resource ownership and costs are reconciled, and the existing exact-source release, migration, recovery, and security gates pass.

## Responsible use

This software supports non-clinical planning. Evidence summaries and scenarios require interpretation in their local context. They do not replace clinical, public-agency, or funding decisions.

Keep credentials, personal information, and operational records out of public issues and pull requests.

## License

[MIT](LICENSE)

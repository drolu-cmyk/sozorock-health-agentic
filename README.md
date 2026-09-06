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

## Responsible use

This software supports non-clinical planning. Evidence summaries and scenarios require interpretation in their local context. They do not replace clinical, public-agency, or funding decisions.

Keep credentials, personal information, and operational records out of public issues and pull requests.

## License

[MIT](LICENSE)

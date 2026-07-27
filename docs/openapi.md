# OpenAPI-Style Endpoint Descriptions

These contracts allow external agents and tools to discover and call the infrastructure.

## Place Analysis

```
POST /place
Content-Type: application/json

{
  "location": "12043"          // ZIP, city, county, or FIPS
}

Response 200
{
  "status": "ok",
  "location": { "name": "...", "fips": "...", "coordinates": { "lat": 0, "lng": 0 } },
  "brief": { "planStatus": "...", "context": "...", "gaps": [] },
  "barriers": { "Transportation": 72, ... },
  "actions": [],
  "hubs": [],
  "hubRanking": [],
  "accessDay": "...",
  "meta": {
    "nonClinical": true,
    "sourceTraceable": true,
    "orchestratedAt": "ISO-8601",
    "agentVersion": "0.2.0"
  },
  "policy": { "ok": true, "violations": [] }
}
```

## Policy Gate

Every response passes through a non-clinical + source-traceable policy check.
If the check fails the status is `"blocked"` and the result is not rendered.

## Audit

Every agent and user action is appended to an append-only audit log with:
- action name
- actor
- timestamp
- summary payload

## Session (Multiplayer)

Live place plans are identified by a session ID.
Share via `?session=<id>`.
Multiple humans and agents can append events and update the same plan object.

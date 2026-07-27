# AWS Deployment Notes

## Recommended Path for Frontend

1. Upload the contents of `frontend/` to an S3 bucket configured for static website hosting.
2. Place a CloudFront distribution in front of the bucket.
3. Set the default root object to `index.html`.
4. Configure cache behaviors appropriate for HTML (short TTL) and assets (longer TTL).

No server is required for the current Explore and Voice interfaces.

## Optional API Layer

If agent endpoints are needed:

- Package the contents of `src/` and `api/` as a Lambda function (Node 18+ runtime) or container image for ECS / Fargate.
- Expose via API Gateway.
- Use environment variables for any external data source endpoints or feature flags.
- Keep the function stateless; all county data should be loaded from public sources or a read-only data store.

## Environment Variables (example)

```
PLACE_DATA_SOURCE=public
CB_CAP_ENDPOINT=
LOG_LEVEL=info
```

## Security Notes

- No individual health records are stored or processed.
- All evidence is public-source and source-traceable.
- CORS and rate limiting should be applied at the API Gateway layer if agents are exposed publicly.

## Cost Profile

Static hosting + CloudFront is the lowest-cost starting point. Scale the compute layer only when live agent volume requires it.

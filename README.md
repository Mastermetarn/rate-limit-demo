# API Rate Limit Demo

A minimal Express and vanilla JavaScript demo of per-key token bucket rate limiting.

- Bucket capacity: 100 tokens
- Refill rate: 100 tokens per minute (approximately 1.67 per second)
- Flood mode: 20 requests per second until manually stopped
- Identity: server-issued demo key sent in the `X-API-Key` header
- Storage: process memory only

The initial bucket permits a burst of 100 requests. After it is depleted, requests are accepted as tokens refill and the remaining requests receive HTTP `429`. This is an average rate with a burst capacity, not a strict rolling-window maximum of 100 requests.

## Run locally

Requires Node.js 20 or later.

```sh
npm ci
npm test
npm start
```

Open <http://localhost:3000>.

With Docker:

```sh
docker build -t rate-limit-demo .
docker run --rm -p 3000:3000 rate-limit-demo
```

## API

Create a key:

```sh
curl -X POST http://localhost:3000/api/key
```

Call the limited endpoint:

```sh
curl -i http://localhost:3000/api/demo \
  -H 'X-API-Key: demo_REPLACE_WITH_YOUR_KEY'
```

Successful requests return HTTP `200`; empty buckets return HTTP `429` with `Retry-After`. Rate state is included in the JSON body and `X-RateLimit-*` response headers. Missing or unknown keys return HTTP `401`.

Demo keys are identifiers for the example, not production credentials. Keys and rate state disappear when the process restarts, and the in-memory store is not shared across replicas.

## Publish to GHCR

Authenticate with GitHub Container Registry, then build and publish the production image manually:

```sh
docker login ghcr.io
docker buildx build \
  --platform linux/amd64 \
  -t ghcr.io/mastermetarn/rate-limit-demo:latest \
  --push .
```

The Norum-web deployment pulls this image and exposes it below `/rate-limit/` through Caddy.

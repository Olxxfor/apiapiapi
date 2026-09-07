# Elite SMS Webhook for Vercel

Standalone Vercel serverless webhook receiver for Elite SMS delivery and
settlement events.

## Endpoint for Elite SMS

After deploying this folder as a Vercel project, put this URL into Elite SMS:

```text
https://YOUR-PROJECT.vercel.app/webhooks/elitesms
```

Enable:

- `delivery.confirmed`
- `delivery.pending`
- `settlement.paid`

The endpoint accepts `POST` JSON and returns HTTP 200 for valid event payloads.
It returns HTTP 400 for invalid payloads and HTTP 405 for unsupported methods.

## Upload/deploy

1. Extract this ZIP.
2. Upload the extracted folder as a new Vercel project, or import the folder
   into a Git repository and deploy it.
3. No build command and no dependencies are required.
4. Open `/healthz` to confirm the deployment:

```json
{"ok":true,"service":"elite-sms-vercel-webhook"}
```

## Duplicate events

The function deduplicates events by `id`, `event_id`, `eventId`, or
`delivery_id`. Without Redis/KV, deduplication is best-effort while the
function instance is warm. For durable deduplication across cold starts,
configure either:

- `KV_REST_API_URL` + `KV_REST_API_TOKEN`, or
- `UPSTASH_REDIS_REST_URL` + `UPSTASH_REDIS_REST_TOKEN`

## Optional forwarding

Set `WEBHOOK_FORWARD_URL` if the received payload should also be forwarded to
the public webhook of the SMShadi bot. If the target requires a bearer token,
set `WEBHOOK_FORWARD_TOKEN`. Do not put API keys in this ZIP or in the URL.
const memoryIds = new Map();
const MAX_MEMORY_IDS = 2000;
const EVENT_TTL_MS = 24 * 60 * 60 * 1000;
const ALLOWED_EVENTS = new Set([
  "delivery.confirmed",
  "delivery.pending",
  "settlement.paid",
]);

function json(res, status, body) {
  res.status(status).setHeader("content-type", "application/json; charset=utf-8");
  return res.json(body);
}

function eventType(payload) {
  return String(payload?.event || payload?.type || payload?.event_type || "unknown").trim();
}

function eventId(payload) {
  const id = payload?.id || payload?.event_id || payload?.eventId || payload?.delivery_id;
  if (id) return String(id);
  return JSON.stringify(payload);
}

function rememberInMemory(id) {
  const now = Date.now();
  for (const [key, expiresAt] of memoryIds) {
    if (expiresAt <= now) memoryIds.delete(key);
  }
  const duplicate = memoryIds.has(id);
  if (!duplicate) {
    memoryIds.set(id, now + EVENT_TTL_MS);
    while (memoryIds.size > MAX_MEMORY_IDS) {
      memoryIds.delete(memoryIds.keys().next().value);
    }
  }
  return duplicate;
}

async function rememberWithRedis(id) {
  const redisUrl = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL;
  const redisToken = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN;
  if (!redisUrl || !redisToken) return null;

  try {
    const key = `elite-sms-webhook:${encodeURIComponent(id)}`;
    const response = await fetch(`${redisUrl.replace(/\/+$/, "")}/set/${key}/1?nx&ex=86400`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${redisToken}`,
      },
    });
    if (!response.ok) return null;
    const result = await response.json().catch(() => ({}));
    return result.result === "OK" ? false : true;
  } catch (error) {
    console.error("[EliteWebhook] Redis idempotency unavailable:", error.message);
    return null;
  }
}

async function forwardEvent(payload) {
  const target = process.env.WEBHOOK_FORWARD_URL;
  if (!target) return;

  const response = await fetch(target, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(process.env.WEBHOOK_FORWARD_TOKEN
        ? { authorization: `Bearer ${process.env.WEBHOOK_FORWARD_TOKEN}` }
        : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!response.ok) {
    throw new Error(`Forward target returned HTTP ${response.status}`);
  }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    return json(res, 200, {
      ok: true,
      provider: "elite-sms",
      endpoint: "webhooks/elitesms",
      acceptedEvents: [...ALLOWED_EVENTS],
    });
  }

  if (req.method !== "POST") {
    res.setHeader("allow", "GET, POST");
    return json(res, 405, { ok: false, error: "Method not allowed" });
  }

  const payload = req.body;
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return json(res, 400, { ok: false, error: "JSON object payload is required" });
  }

  const type = eventType(payload);
  const id = eventId(payload);
  const redisDuplicate = await rememberWithRedis(id);
  const duplicate = redisDuplicate ?? rememberInMemory(id);

  if (!duplicate) {
    console.log(JSON.stringify({
      message: "Elite SMS webhook received",
      event: type,
      eventId: id,
      acceptedEvent: ALLOWED_EVENTS.has(type),
      receivedAt: new Date().toISOString(),
    }));

    try {
      await forwardEvent(payload);
    } catch (error) {
      console.error("[EliteWebhook] Forward failed:", error.message);
      return json(res, 502, {
        ok: false,
        duplicate: false,
        error: "Webhook diterima, tetapi forward target gagal",
      });
    }
  }

  return json(res, 200, {
    ok: true,
    duplicate,
    event: type,
  });
}
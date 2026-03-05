import type { FastifyInstance } from 'fastify';

import { prisma } from './prisma.js';

type WebhookEvent = 
  | 'print.started'
  | 'print.completed'
  | 'print.error'
  | 'print.cancelled'
  | 'print.paused'
  | 'print.resumed';

type WebhookPayload = {
  event: WebhookEvent;
  timestamp: string;
  printer: {
    id: string;
    name: string;
  };
  job?: {
    filename: string;
    progress: number | null;
    durationSec: number | null;
    filamentMm: number | null;
    errorMessage?: string | null;
  };
};

type WebhookConfig = {
  id: string;
  url: string;
  secret: string | null;
  events: WebhookEvent[];
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
};

// In-memory cache for webhook configs
let webhookCache: WebhookConfig[] | null = null;
let cacheTime = 0;
const CACHE_TTL = 60_000; // 1 minute

async function getWebhooks(): Promise<WebhookConfig[]> {
  const now = Date.now();
  if (webhookCache && now - cacheTime < CACHE_TTL) {
    return webhookCache;
  }

  const webhooks = await prisma.webhook.findMany({
    where: { enabled: true },
  });

  webhookCache = webhooks.map(w => ({
    id: w.id,
    url: w.url,
    secret: w.secret,
    events: w.events as WebhookEvent[],
    enabled: w.enabled,
    createdAt: w.createdAt,
    updatedAt: w.updatedAt,
  }));
  cacheTime = now;
  return webhookCache;
}

export function invalidateWebhookCache(): void {
  webhookCache = null;
}

// Trigger webhooks for an event
export async function triggerWebhooks(
  event: WebhookEvent,
  payload: Omit<WebhookPayload, 'event' | 'timestamp'>
): Promise<void> {
  const webhooks = await getWebhooks();
  const relevant = webhooks.filter(w => w.events.includes(event));

  if (relevant.length === 0) return;

  const fullPayload: WebhookPayload = {
    event,
    timestamp: new Date().toISOString(),
    ...payload,
  };

  // Fire all webhooks in parallel, don't wait for responses
  await Promise.allSettled(
    relevant.map(async (webhook) => {
      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
          'X-Webhook-Event': event,
          'X-Webhook-ID': webhook.id,
        };

        if (webhook.secret) {
          // Simple HMAC signature
          const encoder = new TextEncoder();
          const key = await crypto.subtle.importKey(
            'raw',
            encoder.encode(webhook.secret),
            { name: 'HMAC', hash: 'SHA-256' },
            false,
            ['sign']
          );
          const signature = await crypto.subtle.sign(
            'HMAC',
            key,
            encoder.encode(JSON.stringify(fullPayload))
          );
          const sigHex = Array.from(new Uint8Array(signature))
            .map(b => b.toString(16).padStart(2, '0'))
            .join('');
          headers['X-Webhook-Signature'] = `sha256=${sigHex}`;
        }

        const response = await fetch(webhook.url, {
          method: 'POST',
          headers,
          body: JSON.stringify(fullPayload),
        });

        // Log the result
        await prisma.webhookDelivery.create({
          data: {
            webhookId: webhook.id,
            event,
            status: response.ok ? 'success' : 'failed',
            statusCode: response.status,
            responseBody: await response.text().catch(() => ''),
          },
        });
      } catch (error) {
        // Log the error
        await prisma.webhookDelivery.create({
          data: {
            webhookId: webhook.id,
            event,
            status: 'failed',
            statusCode: 0,
            responseBody: error instanceof Error ? error.message : 'Unknown error',
          },
        });
      }
    })
  );
}

// CRUD routes for webhook management
export async function registerWebhookRoutes(app: FastifyInstance) {
  // List webhooks
  app.get('/api/webhooks', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const webhooks = await prisma.webhook.findMany({
      orderBy: { createdAt: 'desc' },
    });

    return reply.send({ webhooks });
  });

  // Create webhook
  app.post('/api/webhooks', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const body = req.body as {
      url: string;
      secret?: string;
      events: WebhookEvent[];
    };

    if (!body.url || !body.events || !Array.isArray(body.events)) {
      return reply.code(400).send({ error: 'INVALID_REQUEST' });
    }

    const webhook = await prisma.webhook.create({
      data: {
        url: body.url,
        secret: body.secret ?? null,
        events: body.events,
        enabled: true,
      },
    });

    invalidateWebhookCache();
    return reply.send({ webhook });
  });

  // Update webhook
  app.patch('/api/webhooks/:id', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params as { id: string };
    const body = req.body as {
      url?: string;
      secret?: string | null;
      events?: WebhookEvent[];
      enabled?: boolean;
    };

    const webhook = await prisma.webhook.update({
      where: { id },
      data: {
        url: body.url,
        secret: body.secret,
        events: body.events,
        enabled: body.enabled,
      },
    });

    invalidateWebhookCache();
    return reply.send({ webhook });
  });

  // Delete webhook
  app.delete('/api/webhooks/:id', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params as { id: string };

    await prisma.webhook.delete({ where: { id } });
    invalidateWebhookCache();

    return reply.send({ success: true });
  });

  // Get delivery logs
  app.get('/api/webhooks/:id/deliveries', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params as { id: string };

    const deliveries = await prisma.webhookDelivery.findMany({
      where: { webhookId: id },
      orderBy: { createdAt: 'desc' },
      take: 50,
    });

    return reply.send({ deliveries });
  });

  // Test webhook
  app.post('/api/webhooks/:id/test', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const { id } = req.params as { id: string };

    const webhook = await prisma.webhook.findUnique({ where: { id } });
    if (!webhook) {
      return reply.code(404).send({ error: 'NOT_FOUND' });
    }

    // Send test event
    await triggerWebhooks('print.completed', {
      printer: { id: 'test', name: 'Test Printer' },
      job: {
        filename: 'test_print.gcode',
        progress: 100,
        durationSec: 3600,
        filamentMm: 5000,
      },
    });

    return reply.send({ success: true });
  });
}

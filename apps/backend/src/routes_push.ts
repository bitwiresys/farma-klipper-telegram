import type { FastifyInstance } from 'fastify';
import webpush from 'web-push';

import { env } from './env.js';
import { prisma } from './prisma.js';
import { logger } from './logger.js';

// VAPID keys should be generated once and stored in env
// Generate with: npx web-push generate-vapid-keys
// Or programmatically: webpush.generateVAPIDKeys()

type PushSubscription = {
  endpoint: string;
  keys: {
    p256dh: string;
    auth: string;
  };
};

function getVapidSubject(): string {
  // Use the backend URL as subject, or a mailto: address
  return env.BACKEND_URL || 'mailto:noreply@farma.local';
}

function initWebPush() {
  if (!env.VAPID_PUBLIC_KEY || !env.VAPID_PRIVATE_KEY) {
    logger.warn('VAPID keys not configured - push notifications disabled');
    return false;
  }

  webpush.setVapidDetails(
    getVapidSubject(),
    env.VAPID_PUBLIC_KEY,
    env.VAPID_PRIVATE_KEY,
  );
  return true;
}

let webPushInitialized = false;

export async function registerPushRoutes(app: FastifyInstance) {
  webPushInitialized = initWebPush();

  // Get VAPID public key (client needs this to subscribe)
  app.get('/api/push/vapid', async (_req, reply) => {
    if (!webPushInitialized || !env.VAPID_PUBLIC_KEY) {
      return reply.code(503).send({
        error: 'PUSH_NOT_CONFIGURED',
        message: 'Push notifications are not configured on this server',
      });
    }

    return reply.send({
      publicKey: env.VAPID_PUBLIC_KEY,
    });
  });

  // Subscribe to push notifications
  app.post('/api/push/subscribe', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    if (!webPushInitialized) {
      return reply.code(503).send({
        error: 'PUSH_NOT_CONFIGURED',
        message: 'Push notifications are not configured',
      });
    }

    const body = (req.body ?? {}) as any;
    const subscription = body.subscription as PushSubscription | undefined;

    if (
      !subscription?.endpoint ||
      !subscription.keys?.p256dh ||
      !subscription.keys?.auth
    ) {
      return reply.code(400).send({
        error: 'INVALID_SUBSCRIPTION',
        message: 'Missing required subscription fields',
      });
    }

    // Upsert subscription
    await prisma.pushSubscription.upsert({
      where: {
        telegramId_endpoint: {
          telegramId,
          endpoint: subscription.endpoint,
        },
      },
      create: {
        telegramId,
        endpoint: subscription.endpoint,
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
      update: {
        p256dh: subscription.keys.p256dh,
        auth: subscription.keys.auth,
      },
    });

    return reply.send({ ok: true });
  });

  // Unsubscribe
  app.post('/api/push/unsubscribe', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const body = (req.body ?? {}) as any;
    const endpoint = body.endpoint as string | undefined;

    if (endpoint) {
      await prisma.pushSubscription.deleteMany({
        where: { telegramId, endpoint },
      });
    } else {
      // Remove all subscriptions for this user
      await prisma.pushSubscription.deleteMany({
        where: { telegramId },
      });
    }

    return reply.send({ ok: true });
  });

  // Get user's push subscriptions
  app.get('/api/push/subscriptions', async (req, reply) => {
    const telegramId = req.auth?.telegramId;
    if (!telegramId) {
      return reply.code(401).send({ error: 'UNAUTHORIZED' });
    }

    const subs = await prisma.pushSubscription.findMany({
      where: { telegramId },
      select: { id: true, endpoint: true, createdAt: true },
    });

    return reply.send({
      subscriptions: subs.map((s) => ({
        id: s.id,
        endpoint: s.endpoint,
        createdAt: s.createdAt.toISOString(),
      })),
    });
  });
}

// Send push notification to a user
export async function sendPushToUser(
  telegramId: string,
  payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: Record<string, unknown>;
  },
): Promise<void> {
  if (!webPushInitialized) return;

  const subs = await prisma.pushSubscription.findMany({
    where: { telegramId },
  });

  if (subs.length === 0) return;

  const notification = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          notification,
        );
      } catch (e: any) {
        const status = e?.statusCode;
        // 410 = subscription expired, 404 = not found
        if (status === 410 || status === 404) {
          logger.info(
            { telegramId, endpoint: sub.endpoint },
            'push subscription expired, removing',
          );
          await prisma.pushSubscription.delete({
            where: { id: sub.id },
          });
        } else {
          logger.warn(
            { telegramId, endpoint: sub.endpoint, err: e?.message },
            'push send failed',
          );
        }
      }
    }),
  );
}

// Broadcast push to all users
export async function broadcastPush(
  payload: {
    title: string;
    body: string;
    icon?: string;
    badge?: string;
    tag?: string;
    data?: Record<string, unknown>;
  },
  filter?: { telegramIds?: string[] },
): Promise<void> {
  if (!webPushInitialized) return;

  const subs = filter?.telegramIds
    ? await prisma.pushSubscription.findMany({
        where: { telegramId: { in: filter.telegramIds } },
      })
    : await prisma.pushSubscription.findMany();

  if (subs.length === 0) return;

  const notification = JSON.stringify(payload);

  await Promise.all(
    subs.map(async (sub) => {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            },
          },
          notification,
        );
      } catch (e: any) {
        const status = e?.statusCode;
        if (status === 410 || status === 404) {
          await prisma.pushSubscription.delete({
            where: { id: sub.id },
          });
        }
      }
    }),
  );
}

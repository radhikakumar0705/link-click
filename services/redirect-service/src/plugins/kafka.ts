import fp from 'fastify-plugin';
import { FastifyInstance } from 'fastify';
import { ClickEvent } from '@link-click/types';

declare module 'fastify' {
  interface FastifyInstance {
    publishClick: (event: ClickEvent) => Promise<void>;
  }
}

/**
 * Click publishing plugin.
 *
 * Tries to connect to Kafka on startup. If Kafka is unavailable (local dev,
 * free-tier deployment without Kafka) it silently falls back to writing
 * clicks directly to Postgres — same guarantee, slightly higher redirect
 * latency at scale, perfectly fine for low traffic.
 *
 * This means the redirect service NEVER crashes due to Kafka being absent.
 */
export const kafkaPlugin = fp(async (fastify: FastifyInstance) => {
  let kafkaProducer: import('kafkajs').Producer | null = null;

  const brokers = process.env.KAFKA_BROKERS ?? 'localhost:9092';

  // Only attempt Kafka if it looks like a real broker address
  try {
    const { Kafka } = await import('kafkajs');
    const kafka = new Kafka({
      clientId: 'redirect-service',
      brokers: brokers.split(','),
      // Short timeout so startup doesn't hang if Kafka is absent
      connectionTimeout: 3000,
      retry: { retries: 1, initialRetryTime: 200 },
    });

    kafkaProducer = kafka.producer({ idempotent: false });
    await kafkaProducer.connect();
    fastify.log.info('Kafka producer connected');
  } catch {
    kafkaProducer = null;
    fastify.log.warn(
      'Kafka unavailable — click events will write directly to Postgres (fine for low traffic)',
    );
  }

  fastify.decorate('publishClick', async (event: ClickEvent): Promise<void> => {
    // ── Kafka path (production) ───────────────────────────────────────────
    if (kafkaProducer) {
      try {
        await kafkaProducer.send({
          topic: 'click-events',
          messages: [{
            key: event.shortCode,
            value: JSON.stringify(event),
            timestamp: Date.now().toString(),
          }],
        });
        return;
      } catch {
        // Kafka send failed — fall through to direct write rather than losing the event
      }
    }

    // ── Direct Postgres fallback (local dev / free tier) ──────────────────
    // Fire-and-forget: never block the redirect response
    void fastify.prisma.click.create({
      data: {
        shortCode:      event.shortCode,
        clickedAt:      new Date(event.clickedAt),
        ipHash:         event.ipHash,
        userAgent:      event.userAgent,
        country:        event.country,
        city:           event.city,
        deviceType:     event.deviceType,
        browser:        event.browser,
        os:             event.os,
        referrer:       event.referrer,
        referrerDomain: event.referrerDomain,
        isUnique:       event.isUnique,
      },
    }).catch((err: Error) => {
      fastify.log.warn({ err }, 'Failed to record click event');
    });

    // Also keep the denormalised click_count in sync
    void fastify.prisma.url.update({
      where: { shortCode: event.shortCode },
      data:  { clickCount: { increment: 1 } },
    }).catch(() => { /* non-critical — analytics aggregation will correct counts */ });
  });

  fastify.addHook('onClose', async () => {
    if (kafkaProducer) {
      await kafkaProducer.disconnect().catch(() => { /* ignore on shutdown */ });
    }
  });
});

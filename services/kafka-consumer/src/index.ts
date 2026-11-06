/**
 * Kafka Consumer — Click Event Processor
 *
 * Per ADR-003: writing to Postgres on every redirect would add 5–20 ms to the
 * hot path. The redirect service publishes ClickEvents to Kafka instead, and
 * this consumer batch-inserts them.
 *
 * Delivery guarantee: at-least-once. Offsets are committed only after a batch
 * is safely in Postgres, so a crash mid-batch means the batch is re-read on
 * restart, not lost. (Previously offsets were resolved as soon as an event was
 * buffered in memory, so a crash in the 5 s flush window dropped those clicks.)
 *
 * It also updates the denormalised urls.click_count in the same transaction.
 * is_unique is decided by the redirect service (Redis SET NX per visitor per
 * day), which sees every click; this consumer only sees one batch at a time.
 */

import { Kafka, Consumer, EachBatchPayload } from 'kafkajs';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { ClickEvent } from '@link-click/types';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const TOPIC = 'click-events';
const CONSUMER_GROUP = 'click-processor';
// Kafka waits up to this long to fill a fetch, so writes still happen in batches.
const MAX_BATCH_WAIT_MS = 5000;

const prisma = new PrismaClient({ log: ['warn', 'error'] });

/** Inserts the clicks and bumps click_count atomically. Throws on failure so the batch is retried. */
async function writeBatch(events: ClickEvent[]): Promise<void> {
  const countsByCode = new Map<string, number>();
  for (const e of events) countsByCode.set(e.shortCode, (countsByCode.get(e.shortCode) ?? 0) + 1);

  await prisma.$transaction([
    prisma.click.createMany({
      data: events.map((e) => ({
        shortCode: e.shortCode,
        clickedAt: new Date(e.clickedAt),
        ipHash: e.ipHash,
        userAgent: e.userAgent,
        country: e.country,
        city: e.city,
        deviceType: e.deviceType,
        browser: e.browser,
        os: e.os,
        referrer: e.referrer,
        referrerDomain: e.referrerDomain,
        isUnique: e.isUnique,
      })),
    }),
    ...[...countsByCode].map(([code, count]) =>
      prisma.url.updateMany({ where: { shortCode: code }, data: { clickCount: { increment: count } } }),
    ),
  ]);
}

function safeHost(url: string | undefined): string {
  try {
    return url ? new URL(url).host : 'unset';
  } catch {
    return 'unparseable';
  }
}

async function main(): Promise<void> {
  // Log only the host: the full DATABASE_URL contains the password.
  logger.info({ dbHost: safeHost(process.env.DATABASE_URL) }, 'Database in use');
  const kafka = new Kafka({
    clientId: 'kafka-consumer',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });

  const consumer: Consumer = kafka.consumer({ groupId: CONSUMER_GROUP, maxWaitTimeInMs: MAX_BATCH_WAIT_MS });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  await consumer.run({
    eachBatchAutoResolve: false, // we resolve offsets ourselves, after the write
    eachBatch: async ({ batch, resolveOffset, commitOffsetsIfNecessary, heartbeat, isRunning }: EachBatchPayload) => {
      if (!isRunning() || batch.messages.length === 0) return;

      const events: ClickEvent[] = [];
      for (const message of batch.messages) {
        if (!message.value) continue;
        try {
          events.push(JSON.parse(message.value.toString()) as ClickEvent);
        } catch (err) {
          // A malformed message would fail forever; skip it rather than block the partition.
          logger.warn({ err, offset: message.offset }, 'Skipping unparseable click event');
        }
      }

      if (events.length > 0) {
        // If this throws, kafkajs retries the batch from the last committed offset.
        await writeBatch(events);
        logger.info({ count: events.length }, 'Click batch written');
      }

      resolveOffset(batch.messages[batch.messages.length - 1].offset);
      await commitOffsetsIfNecessary();
      await heartbeat();
    },
  });

  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down Kafka consumer...');
    await consumer.disconnect(); // finishes the in-flight batch, then commits
    await prisma.$disconnect();
    process.exit(0);
  };

  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

main().catch((err) => {
  logger.error({ err }, 'Fatal error in Kafka consumer');
  process.exit(1);
});

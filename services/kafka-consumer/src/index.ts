/**
 * Kafka Consumer — Click Event Processor
 *
 * Per ADR-003: Writing directly to Postgres on every redirect would add
 * 5-20ms of DB latency to the hot path. This consumer decouples ingestion
 * from storage: it receives batches of ClickEvents from Kafka and
 * batch-inserts them into Postgres every 5 seconds.
 *
 * It also:
 * - Deduplicates clicks by ip_hash + short_code (sets is_unique)
 * - Updates the denormalised click_count on the urls table
 */

import { Kafka, Consumer, EachBatchPayload } from 'kafkajs';
import { PrismaClient } from '@prisma/client';
import pino from 'pino';
import { ClickEvent } from '@link-click/types';

const logger = pino({ level: process.env.LOG_LEVEL ?? 'info' });

const TOPIC = 'click-events';
const BATCH_FLUSH_INTERVAL_MS = 5000;
const CONSUMER_GROUP = 'click-processor';

// ── Pending batch ─────────────────────────────────────────────────────────────
let pendingBatch: ClickEvent[] = [];
let flushTimer: NodeJS.Timeout | null = null;

const prisma = new PrismaClient({
  log: ['query', 'warn', 'error'],
});

async function flushBatch(): Promise<void> {
  if (pendingBatch.length === 0) return;

  const batch = pendingBatch;
  pendingBatch = [];

  logger.info({ count: batch.length }, 'Flushing click batch to Postgres');

  try {
    // Determine uniqueness: first click from this ip_hash + short_code combination
    const seen = new Set<string>();
    const enriched = batch.map((event) => {
      const key = `${event.ipHash}:${event.shortCode}`;
      const isUnique = !seen.has(key);
      seen.add(key);
      return { ...event, isUnique };
    });

    // Batch insert — createMany is far more efficient than individual creates
    await prisma.click.createMany({
      data: enriched.map((e) => ({
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
      skipDuplicates: false,
    });

    // Update denormalised click_count per short_code
    const countsByCode = new Map<string, number>();
    for (const e of enriched) {
      countsByCode.set(e.shortCode, (countsByCode.get(e.shortCode) ?? 0) + 1);
    }

    logger.info({ countsByCode: Object.fromEntries(countsByCode) }, 'About to update click counts');

    for (const [code, count] of countsByCode.entries()) {
      logger.info({ code, count }, '>>> LOOP ITERATION START');
      try {
        const result = await prisma.url.updateMany({
          where: { shortCode: code },
          data: { clickCount: { increment: count } },
        });
        logger.info({ code, matched: result.count }, '>>> LOOP ITERATION DONE');
      } catch (loopErr) {
        logger.error({ loopErr, code }, '>>> LOOP ITERATION ERROR');
      }
    }

    logger.info({ count: batch.length }, 'Click batch flushed successfully');
  } catch (err) {
    logger.error({ err }, 'Failed to flush click batch — events will be re-consumed on restart');
    // Re-add to pending so they're retried on next flush
    pendingBatch = [...batch, ...pendingBatch];
  }
}

async function main(): Promise<void> {
  logger.info({ dbUrl: process.env.DATABASE_URL }, 'DATABASE_URL in use');
  const kafka = new Kafka({
    clientId: 'kafka-consumer',
    brokers: (process.env.KAFKA_BROKERS ?? 'localhost:9092').split(','),
  });

  const consumer: Consumer = kafka.consumer({ groupId: CONSUMER_GROUP });
  await consumer.connect();
  await consumer.subscribe({ topic: TOPIC, fromBeginning: false });

  // Schedule periodic flushes
  flushTimer = setInterval(() => void flushBatch(), BATCH_FLUSH_INTERVAL_MS);

  await consumer.run({
    eachBatch: async ({ batch, resolveOffset, heartbeat }: EachBatchPayload) => {
      for (const message of batch.messages) {
        if (!message.value) continue;

        try {
          const event = JSON.parse(message.value.toString()) as ClickEvent;
          pendingBatch.push(event);
          resolveOffset(message.offset);
          await heartbeat(); // Keep the consumer alive during large batches
        } catch (err) {
          logger.warn({ err, offset: message.offset }, 'Failed to parse click event — skipping');
        }
      }
    },
  });

  // Graceful shutdown
  const shutdown = async (): Promise<void> => {
    logger.info('Shutting down Kafka consumer...');
    if (flushTimer) clearInterval(flushTimer);
    await flushBatch(); // Flush remaining events before exit
    await consumer.disconnect();
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
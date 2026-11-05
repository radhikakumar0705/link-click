import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import cors from '@fastify/cors';
import { prismaPlugin } from './plugins/prisma';
import { redisPlugin } from './plugins/redis';
import { authPlugin } from './plugins/auth';
import { analyticsRoutes } from './routes/analytics';
import { registerAggregationJobs } from './jobs/aggregation';
import { env } from './lib/env';

const server = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization'],
  },
});

async function bootstrap(): Promise<void> {
  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(cors, {
    // Was `false` in production, which blocked the extension from ever loading analytics.
    origin: env.NODE_ENV === 'production' ? (env.EXTENSION_ORIGIN ?? false) : true,
    methods: ['GET'],
  });

  await server.register(prismaPlugin);
  await server.register(redisPlugin);
  await server.register(authPlugin);

  await server.register(analyticsRoutes, { prefix: '/analytics' });

  server.get('/health', async () => ({
    status: 'ok',
    service: 'analytics-service',
    ts: new Date().toISOString(),
  }));

  // Scheduled jobs — run in-process for v1
  registerAggregationJobs(server);

  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  server.log.info(`analytics-service listening on :${env.PORT}`);
}

bootstrap().catch((err) => {
  server.log.error(err);
  process.exit(1);
});

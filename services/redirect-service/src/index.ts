import Fastify from 'fastify';
import helmet from '@fastify/helmet';
import { prismaPlugin } from './plugins/prisma';
import { redisPlugin } from './plugins/redis';
import { kafkaPlugin } from './plugins/kafka';
import { redirectPlugin } from './plugins/redirect';
import { env } from './lib/env';

const server = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    redact: ['req.ip'],
  },
  trustProxy: true, // Respect X-Forwarded-For from ALB/CloudFront
});

async function bootstrap(): Promise<void> {
  await server.register(helmet, { contentSecurityPolicy: false });

  // Infrastructure must come before redirect plugin which uses all three
  await server.register(prismaPlugin);
  await server.register(redisPlugin);
  await server.register(kafkaPlugin);

  // Route handlers
  await server.register(redirectPlugin);

  server.get('/health', async () => ({
    status: 'ok',
    service: 'redirect-service',
    ts: new Date().toISOString(),
  }));

  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  server.log.info(`redirect-service listening on :${env.PORT}`);
}

bootstrap().catch((err) => {
  server.log.error(err);
  process.exit(1);
});

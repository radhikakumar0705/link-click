import Fastify from 'fastify';
import cors from '@fastify/cors';
import helmet from '@fastify/helmet';
import { prismaPlugin } from './plugins/prisma';
import { redisPlugin } from './plugins/redis';
import { authPlugin } from './plugins/auth';
import { apiKeyAuthPlugin } from './plugins/api-key-auth';
import { authRoutes } from './routes/auth';
import { shortenRoutes } from './routes/shorten';
import { linksRoutes } from './routes/links';
import { qrRoutes } from './routes/qr';
import { apiKeyRoutes } from './routes/api-keys';
import { env } from './lib/env';

const server = Fastify({
  logger: {
    level: env.LOG_LEVEL,
    redact: ['req.headers.authorization', 'req.body.password', 'req.body.refreshToken'],
  },
});

async function bootstrap(): Promise<void> {
  await server.register(helmet, { contentSecurityPolicy: false });
  await server.register(cors, {
    origin: env.NODE_ENV === 'production' ? env.EXTENSION_ORIGIN : true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

  // Infrastructure — registration order matters:
  // prisma and redis must be ready before auth, auth before apiKeyAuth
  await server.register(prismaPlugin);
  await server.register(redisPlugin);
  await server.register(authPlugin);
  await server.register(apiKeyAuthPlugin);

  // Routes
  await server.register(authRoutes,    { prefix: '/auth' });
  await server.register(shortenRoutes, { prefix: '/' });
  await server.register(linksRoutes,   { prefix: '/user' });
  await server.register(qrRoutes,      { prefix: '/user' });
  await server.register(apiKeyRoutes,  { prefix: '/user' });

  server.get('/health', async () => ({
    status: 'ok',
    service: 'write-service',
    ts: new Date().toISOString(),
  }));

  await server.listen({ port: env.PORT, host: '0.0.0.0' });
  server.log.info(`write-service listening on :${env.PORT}`);
}

bootstrap().catch((err) => {
  server.log.error(err);
  process.exit(1);
});

import { createServer } from 'http';
import { env } from './config/env';
import { rootLogger } from './config/logger';
import { prisma } from './db/prisma';
import { createApp } from './app';
import { initSocket } from './common/utils/socket-server';

const app = createApp();
const httpServer = createServer(app);

// Initialize Socket.io
initSocket(httpServer);

const server = httpServer.listen(env.PORT, () => {
  rootLogger.info(
    { port: env.PORT, env: env.NODE_ENV, version: env.APP_VERSION },
    `HTTP server listening on port ${env.PORT}`,
  );
});

async function shutdown(signal: string) {
  rootLogger.info({ signal }, `Shutdown: received ${signal}, closing server`);
  server.close(async () => {
    await prisma.$disconnect();
    process.exit(0);
  });
}

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

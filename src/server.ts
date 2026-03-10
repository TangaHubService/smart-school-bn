import { createServer } from 'http';
import { env } from './config/env';
import { prisma } from './db/prisma';
import { createApp } from './app';
import { initSocket } from './common/utils/socket-server';

const app = createApp();
const httpServer = createServer(app);

// Initialize Socket.io
initSocket(httpServer);

const server = httpServer.listen(env.PORT, () => {
  console.log(`smart-school-bn listening on port ${env.PORT}`);
});

async function shutdown(signal: string) {
  console.log(`Received ${signal}. Shutting down...`);
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

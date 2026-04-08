import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';

import { rootLogger } from '../../config/logger';

const socketLog = rootLogger.child({ module: 'socket.io' });

let io: Server;

function resolveTransactionRooms(transactionId: unknown): string[] {
  if (typeof transactionId !== 'string') {
    return [];
  }

  const normalized = transactionId.trim();
  if (!normalized) {
    return [];
  }

  if (normalized.startsWith('trx-')) {
    const raw = normalized.slice(4);
    return raw ? [normalized, raw] : [normalized];
  }

  return [normalized, `trx-${normalized}`];
}

export const initSocket = (server: HttpServer) => {
  socketLog.info('Initializing WebSocket server');
  io = new Server(server, {
    cors: {
      origin: '*', // Adjust this in production
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    socketLog.info({ socketId: socket.id }, 'Client connected');

    // Client joins a transaction room
    socket.on('joinTransaction', ({ transactionId }) => {
      const rooms = resolveTransactionRooms(transactionId);
      if (rooms.length === 0) {
        socketLog.warn({ socketId: socket.id, transactionId }, 'Client attempted to join invalid transaction room');
        return;
      }

      for (const room of rooms) {
        socket.join(room);
      }

      socketLog.info(
        { socketId: socket.id, transactionId, rooms },
        'Client joined transaction room',
      );
    });

    socket.on('disconnect', () => {
      socketLog.info({ socketId: socket.id }, 'Client disconnected');
    });
  });

  return io;
};

export const getIO = (): Server => {
  if (!io) {
    throw new Error('Socket.io not initialized!');
  }
  return io;
};

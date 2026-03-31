import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';

import { rootLogger } from '../../config/logger';

const socketLog = rootLogger.child({ module: 'socket.io' });

let io: Server;

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
      socket.join(transactionId);
      socketLog.info({ socketId: socket.id, transactionId }, 'Client joined transaction room');
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

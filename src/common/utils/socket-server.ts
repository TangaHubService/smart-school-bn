import { Server, Socket } from 'socket.io';
import { Server as HttpServer } from 'http';

let io: Server;

export const initSocket = (server: HttpServer) => {
  console.log('Socket.io initializing...');
  io = new Server(server, {
    cors: {
      origin: '*', // Adjust this in production
      methods: ['GET', 'POST'],
    },
  });

  io.on('connection', (socket: Socket) => {
    console.log('Socket Client connected:', socket.id);

    // Client joins a transaction room
    socket.on('joinTransaction', ({ transactionId }) => {
      socket.join(transactionId);
      console.log(`Socket Client joined room: ${transactionId}`);
    });

    socket.on('disconnect', () => {
      console.log('Socket Client disconnected:', socket.id);
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

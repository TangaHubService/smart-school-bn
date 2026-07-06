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

function chatRoom(chatId: string) {
  return `chat-${chatId}`;
}

/**
 * Online presence per class chat: chatId -> userId -> number of live sockets for that
 * user in that chat (a user can have multiple tabs/devices open). Only removed from the
 * broadcast set when the count drops to zero, so closing one tab doesn't show them offline.
 */
const chatPresence = new Map<string, Map<string, number>>();
/** Tracks which (chatId, userId) pairs a given socket joined, so disconnect can clean up. */
const socketMemberships = new Map<string, Array<{ chatId: string; userId: string }>>();

function broadcastPresence(io: Server, chatId: string) {
  const onlineUserIds = [...(chatPresence.get(chatId)?.keys() ?? [])];
  io.to(chatRoom(chatId)).emit('chat:presence', { chatId, onlineUserIds });
}

function addPresence(io: Server, chatId: string, userId: string) {
  const chatMap = chatPresence.get(chatId) ?? new Map<string, number>();
  chatMap.set(userId, (chatMap.get(userId) ?? 0) + 1);
  chatPresence.set(chatId, chatMap);
  broadcastPresence(io, chatId);
}

function removePresence(io: Server, chatId: string, userId: string) {
  const chatMap = chatPresence.get(chatId);
  if (!chatMap) return;
  const next = (chatMap.get(userId) ?? 1) - 1;
  if (next <= 0) {
    chatMap.delete(userId);
  } else {
    chatMap.set(userId, next);
  }
  broadcastPresence(io, chatId);
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
        socketLog.warn(
          { socketId: socket.id, transactionId },
          'Client attempted to join invalid transaction room'
        );
        return;
      }

      for (const room of rooms) {
        socket.join(room);
      }

      socketLog.info(
        { socketId: socket.id, transactionId, rooms },
        'Client joined transaction room'
      );
    });

    socket.on('chat:join', ({ chatId, userId }: { chatId?: string; userId?: string }) => {
      if (!chatId || !userId) return;
      socket.join(chatRoom(chatId));
      const memberships = socketMemberships.get(socket.id) ?? [];
      memberships.push({ chatId, userId });
      socketMemberships.set(socket.id, memberships);
      addPresence(io, chatId, userId);
    });

    socket.on('chat:leave', ({ chatId, userId }: { chatId?: string; userId?: string }) => {
      if (!chatId || !userId) return;
      socket.leave(chatRoom(chatId));
      const memberships = socketMemberships.get(socket.id) ?? [];
      socketMemberships.set(
        socket.id,
        memberships.filter(m => !(m.chatId === chatId && m.userId === userId))
      );
      removePresence(io, chatId, userId);
    });

    socket.on('chat:typing', ({ chatId, userId, userName }: { chatId?: string; userId?: string; userName?: string }) => {
      if (!chatId || !userId) return;
      socket.to(chatRoom(chatId)).emit('chat:typing', { chatId, userId, userName });
    });

    socket.on('chat:stopTyping', ({ chatId, userId }: { chatId?: string; userId?: string }) => {
      if (!chatId || !userId) return;
      socket.to(chatRoom(chatId)).emit('chat:stopTyping', { chatId, userId });
    });

    socket.on('disconnect', () => {
      socketLog.info({ socketId: socket.id }, 'Client disconnected');
      const memberships = socketMemberships.get(socket.id);
      if (memberships) {
        for (const { chatId, userId } of memberships) {
          removePresence(io, chatId, userId);
        }
        socketMemberships.delete(socket.id);
      }
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

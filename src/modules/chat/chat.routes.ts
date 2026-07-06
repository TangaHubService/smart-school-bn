import { Router } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ChatController } from './chat.controller';
import { sendMessageSchema, reactionSchema } from './chat.schemas';

const controller = new ChatController();
export const chatRoutes = Router();

chatRoutes.use(authenticate, enforceTenant);

chatRoutes.get(
  '/chats/class/:classRoomId',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.getOrCreateChat(req, res))
);

chatRoutes.get(
  '/chats/:chatId/messages',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.listMessages(req, res))
);

chatRoutes.get(
  '/chats/:chatId/messages/pinned',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.listPinnedMessages(req, res))
);

chatRoutes.post(
  '/chats/:chatId/messages',
  requirePermissions([PERMISSIONS.CHAT_SEND]),
  validateBody(sendMessageSchema),
  asyncHandler((req, res) => controller.sendMessage(req, res))
);

chatRoutes.post(
  '/chats/:chatId/messages/:messageId/reactions',
  requirePermissions([PERMISSIONS.CHAT_SEND]),
  validateBody(reactionSchema),
  asyncHandler((req, res) => controller.react(req, res))
);

chatRoutes.delete(
  '/chats/:chatId/messages/:messageId/reactions',
  requirePermissions([PERMISSIONS.CHAT_SEND]),
  asyncHandler((req, res) => controller.removeReaction(req, res))
);

chatRoutes.post(
  '/chats/:chatId/messages/:messageId/pin',
  requirePermissions([PERMISSIONS.CHAT_PIN]),
  asyncHandler((req, res) => controller.pinMessage(req, res))
);

chatRoutes.delete(
  '/chats/:chatId/messages/:messageId/pin',
  requirePermissions([PERMISSIONS.CHAT_PIN]),
  asyncHandler((req, res) => controller.unpinMessage(req, res))
);

chatRoutes.delete(
  '/chats/:chatId/messages/:messageId',
  requirePermissions([PERMISSIONS.CHAT_MODERATE]),
  asyncHandler((req, res) => controller.deleteMessage(req, res))
);

chatRoutes.post(
  '/chats/:chatId/read',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.markRead(req, res))
);

chatRoutes.get(
  '/chats/:chatId/read-receipts',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.getReadReceipts(req, res))
);

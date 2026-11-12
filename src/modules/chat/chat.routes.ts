import { Router } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requireActiveSubscription } from '../../common/middleware/subscription-gate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ChatController } from './chat.controller';
import { sendMessageSchema, reactionSchema, createGroupSchema, updateGroupSchema, directChatSchema, addMembersSchema } from './chat.schemas';

const controller = new ChatController();
export const chatRoutes = Router();

chatRoutes.use(authenticate, enforceTenant, requireActiveSubscription);

// Chat list (WhatsApp-style inbox), contacts, groups and direct messages.
chatRoutes.get(
  '/chats',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.listMyChats(req, res))
);

chatRoutes.get(
  '/chats/contacts',
  requirePermissions([PERMISSIONS.CHAT_SEND]),
  asyncHandler((req, res) => controller.listContacts(req, res))
);

chatRoutes.post(
  '/chats/groups',
  requirePermissions([PERMISSIONS.CHAT_SEND]),
  validateBody(createGroupSchema),
  asyncHandler((req, res) => controller.createGroup(req, res))
);

chatRoutes.post(
  '/chats/direct',
  requirePermissions([PERMISSIONS.CHAT_SEND]),
  validateBody(directChatSchema),
  asyncHandler((req, res) => controller.openDirectChat(req, res))
);

chatRoutes.patch(
  '/chats/:chatId',
  requirePermissions([PERMISSIONS.CHAT_SEND]),
  validateBody(updateGroupSchema),
  asyncHandler((req, res) => controller.updateGroup(req, res))
);

chatRoutes.post(
  '/chats/:chatId/members',
  requirePermissions([PERMISSIONS.CHAT_SEND]),
  validateBody(addMembersSchema),
  asyncHandler((req, res) => controller.addMembers(req, res))
);

chatRoutes.delete(
  '/chats/:chatId/members/:userId',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.removeMember(req, res))
);

chatRoutes.get(
  '/chats/class/:classRoomId',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.getOrCreateChat(req, res))
);

chatRoutes.get(
  '/chats/:chatId',
  requirePermissions([PERMISSIONS.CHAT_READ]),
  asyncHandler((req, res) => controller.getChat(req, res))
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
  // Senders can delete their own messages; the service checks moderation rights for others.
  requirePermissions([PERMISSIONS.CHAT_SEND]),
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

import { Router } from 'express';
import { authenticate } from '../../common/middleware/authenticate.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ChatController } from './chat.controller';
import { sendMessageSchema } from './chat.schemas';

const controller = new ChatController();
export const chatRoutes = Router();

chatRoutes.use(authenticate, enforceTenant);

chatRoutes.get('/chats/class/:classRoomId', requirePermissions([PERMISSIONS.COURSES_READ]), asyncHandler((req, res) => controller.getOrCreateChat(req, res)));
chatRoutes.get('/chats/:chatId/messages', requirePermissions([PERMISSIONS.COURSES_READ]), asyncHandler((req, res) => controller.listMessages(req, res)));
chatRoutes.post('/chats/:chatId/messages', requirePermissions([PERMISSIONS.COURSES_READ]), validateBody(sendMessageSchema), asyncHandler((req, res) => controller.sendMessage(req, res)));

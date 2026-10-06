import { Router } from 'express';

import {
  authenticate,
  optionalAuthenticate,
} from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { SupportController } from './support.controller';

const controller = new SupportController();

export const supportRoutes = Router();

// Public contact form → ticket (optional auth so logged-in users are linked)
supportRoutes.post(
  '/support/tickets/public',
  optionalAuthenticate,
  asyncHandler((req, res) => controller.createPublicTicket(req, res))
);

// Authenticated user creates a ticket in their tenant scope
supportRoutes.post(
  '/support/tickets',
  authenticate,
  asyncHandler((req, res) => controller.createTicket(req, res))
);

supportRoutes.get(
  '/support/tickets',
  authenticate,
  requirePermissions([PERMISSIONS.SUPPORT_TICKETS_READ]),
  asyncHandler((req, res) => controller.listTickets(req, res))
);

supportRoutes.get(
  '/support/tickets/:id',
  authenticate,
  requirePermissions([PERMISSIONS.SUPPORT_TICKETS_READ]),
  asyncHandler((req, res) => controller.getTicket(req, res))
);

supportRoutes.post(
  '/support/tickets/:id/replies',
  authenticate,
  requirePermissions([PERMISSIONS.SUPPORT_TICKETS_READ]),
  asyncHandler((req, res) => controller.replyTicket(req, res))
);

supportRoutes.patch(
  '/support/tickets/:id',
  authenticate,
  requirePermissions([PERMISSIONS.SUPPORT_TICKETS_MANAGE]),
  asyncHandler((req, res) => controller.updateTicket(req, res))
);

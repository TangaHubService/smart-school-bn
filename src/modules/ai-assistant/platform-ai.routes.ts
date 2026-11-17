import { NextFunction, Request, Response, Router } from 'express';

import { AppError } from '../../common/errors/app-error';
import { authenticate } from '../../common/middleware/authenticate.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { sendSuccess } from '../../common/utils/response';
import { updateAiSettingsSchema } from './ai-assistant.schemas';
import { AiAssistantService } from './ai-assistant.service';

const service = new AiAssistantService();

/**
 * Platform-wide AI settings: one OpenAI key, model and limits shared by every school.
 * Only the super admin may read or change them (school admins have no AI settings).
 * Mounted at /platform/ai; no tenant check, because super admins work across schools.
 */
export const platformAiRoutes = Router();

function requireSuperAdmin(req: Request, _res: Response, next: NextFunction) {
  if (!req.user?.roles?.includes('SUPER_ADMIN')) {
    next(new AppError(403, 'AUTH_INSUFFICIENT_PERMISSIONS', 'Only the platform super admin can manage AI settings'));
    return;
  }
  next();
}

platformAiRoutes.use(authenticate, requireSuperAdmin);

platformAiRoutes.get(
  '/settings',
  asyncHandler(async (req: Request, res: Response) => sendSuccess(req, res, await service.getSettings()))
);

platformAiRoutes.put(
  '/settings',
  validateBody(updateAiSettingsSchema),
  asyncHandler(async (req: Request, res: Response) => {
    const input = updateAiSettingsSchema.parse(req.body);
    return sendSuccess(req, res, await service.updateSettings(input, req.user!));
  })
);

platformAiRoutes.delete(
  '/settings/key',
  asyncHandler(async (req: Request, res: Response) => sendSuccess(req, res, await service.removeKey(req.user!)))
);

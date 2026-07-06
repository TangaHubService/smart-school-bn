import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { FilesController } from './files.controller';
import { signUploadSchema } from './files.schemas';

const filesController = new FilesController();

export const filesRoutes = Router();

filesRoutes.use(authenticate, enforceTenant);

filesRoutes.post(
  '/files/sign-upload',
  requirePermissions([PERMISSIONS.FILES_UPLOAD]),
  validateBody(signUploadSchema),
  asyncHandler((req, res) => filesController.signUpload(req, res))
);

filesRoutes.get(
  '/files/:assetId/view',
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => filesController.getFileViewUrl(req, res))
);

filesRoutes.get(
  '/files/:assetId/stream',
  requirePermissions([PERMISSIONS.COURSES_READ]),
  asyncHandler((req, res) => filesController.streamFile(req, res))
);

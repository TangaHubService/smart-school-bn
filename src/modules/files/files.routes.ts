import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import {
  requireAnyPermissions,
  requirePermissions,
} from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { requireActiveSubscription } from '../../common/middleware/subscription-gate.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { FilesController } from './files.controller';
import { signUploadSchema } from './files.schemas';

const filesController = new FilesController();

export const filesRoutes = Router();

filesRoutes.use(authenticate, enforceTenant, requireActiveSubscription);

/**
 * Anyone who can see learning material or announcements may ask for a file;
 * FilesService then checks the user's relationship to that specific file.
 */
const FILE_READ_PERMISSIONS = [
  PERMISSIONS.COURSES_READ,
  PERMISSIONS.STUDENT_MY_COURSES_READ,
  PERMISSIONS.PARENT_MY_CHILDREN_READ,
  PERMISSIONS.ANNOUNCEMENTS_READ,
  PERMISSIONS.ANNOUNCEMENTS_MY_READ,
];

filesRoutes.post(
  '/files/sign-upload',
  requirePermissions([PERMISSIONS.FILES_UPLOAD]),
  validateBody(signUploadSchema),
  asyncHandler((req, res) => filesController.signUpload(req, res))
);

filesRoutes.get(
  '/files/:assetId/view',
  requireAnyPermissions(FILE_READ_PERMISSIONS),
  asyncHandler((req, res) => filesController.getFileViewUrl(req, res))
);

filesRoutes.get(
  '/files/:assetId/stream',
  requireAnyPermissions(FILE_READ_PERMISSIONS),
  asyncHandler((req, res) => filesController.streamFile(req, res))
);

import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { sendSuccess } from '../../common/utils/response';

export const rolesRoutes = Router();

rolesRoutes.get(
  '/navigation',
  authenticate,
  enforceTenant,
  requirePermissions(['roles.read']),
  (req, res) =>
    sendSuccess(req, res, {
      roles: req.user?.roles ?? [],
      permissions: req.user?.permissions ?? [],
      navigation: [
        { name: 'Dashboard', path: '/', requiredPermissions: [] },
        {
          name: 'Users',
          path: '/users',
          requiredPermissions: ['users.read'],
        },
      ],
    }),
);

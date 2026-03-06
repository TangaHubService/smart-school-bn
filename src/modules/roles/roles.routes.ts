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
          name: 'Tenant Onboarding',
          path: '/tenants/new',
          requiredPermissions: ['tenants.create'],
        },
        {
          name: 'School Setup',
          path: '/setup',
          requiredPermissions: ['school.setup.manage'],
        },
        {
          name: 'Academics',
          path: '/academics',
          requiredPermissions: ['academic_year.manage'],
        },
        {
          name: 'Staff',
          path: '/staff',
          requiredPermissions: ['staff.invite'],
        },
        {
          name: 'Users',
          path: '/users',
          requiredPermissions: ['users.read'],
        },
      ],
    }),
);

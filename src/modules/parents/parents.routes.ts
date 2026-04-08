import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { ParentsController } from './parents.controller';
import {
  createParentSchema,
  linkParentStudentSchema,
  updateParentSchema,
} from './parents.schemas';

const parentsController = new ParentsController();

export const parentsRoutes = Router();

parentsRoutes.use(authenticate, enforceTenant);

parentsRoutes.get(
  '/parents',
  requirePermissions([PERMISSIONS.PARENTS_MANAGE]),
  asyncHandler((req, res) => parentsController.listParents(req, res)),
);

parentsRoutes.post(
  '/parents',
  requirePermissions([PERMISSIONS.PARENTS_MANAGE]),
  validateBody(createParentSchema),
  asyncHandler((req, res) => parentsController.createParent(req, res)),
);

parentsRoutes.patch(
  '/parents/:id',
  requirePermissions([PERMISSIONS.PARENTS_MANAGE]),
  validateBody(updateParentSchema),
  asyncHandler((req, res) => parentsController.updateParent(req, res)),
);

parentsRoutes.get(
  '/parents/linkable-students',
  requirePermissions([PERMISSIONS.PARENTS_MANAGE]),
  asyncHandler((req, res) => parentsController.listLinkableStudents(req, res)),
);

parentsRoutes.post(
  '/parents/:id/link-student',
  requirePermissions([PERMISSIONS.PARENTS_MANAGE]),
  validateBody(linkParentStudentSchema),
  asyncHandler((req, res) => parentsController.linkStudent(req, res)),
);

parentsRoutes.get(
  '/parents/me/students',
  requirePermissions([PERMISSIONS.PARENT_MY_CHILDREN_READ]),
  asyncHandler((req, res) => parentsController.listMyStudents(req, res)),
);

parentsRoutes.get(
  '/parents/me/students/:studentId/attendance',
  requirePermissions([PERMISSIONS.PARENT_MY_CHILDREN_READ]),
  asyncHandler((req, res) => parentsController.getMyStudentAttendance(req, res)),
);

parentsRoutes.get(
  '/parents/me/students/:studentId/learning',
  requirePermissions([PERMISSIONS.PARENT_MY_CHILDREN_READ]),
  asyncHandler((req, res) => parentsController.getMyStudentLearning(req, res)),
);

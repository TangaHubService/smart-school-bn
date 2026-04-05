import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import { requirePermissions } from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { StudentsController } from './students.controller';
import {
  createStudentSchema,
  studentImportSchema,
  updateStudentSchema,
} from './students.schemas';

const studentsController = new StudentsController();

export const studentsRoutes = Router();

studentsRoutes.use(authenticate, enforceTenant);

studentsRoutes.post(
  '/students',
  requirePermissions([PERMISSIONS.STUDENTS_MANAGE]),
  validateBody(createStudentSchema),
  asyncHandler((req, res) => studentsController.createStudent(req, res)),
);

studentsRoutes.get(
  '/students',
  requirePermissions([PERMISSIONS.STUDENTS_READ]),
  asyncHandler((req, res) => studentsController.listStudents(req, res)),
);

studentsRoutes.post(
  '/students/import',
  requirePermissions([PERMISSIONS.STUDENTS_MANAGE]),
  validateBody(studentImportSchema),
  asyncHandler((req, res) => studentsController.importStudents(req, res)),
);

studentsRoutes.get(
  '/students/export',
  requirePermissions([PERMISSIONS.STUDENTS_READ]),
  asyncHandler((req, res) => studentsController.exportStudents(req, res)),
);

studentsRoutes.get(
  '/students/:id',
  requirePermissions([PERMISSIONS.STUDENTS_READ]),
  asyncHandler((req, res) => studentsController.getStudent(req, res)),
);

studentsRoutes.patch(
  '/students/:id',
  requirePermissions([PERMISSIONS.STUDENTS_MANAGE]),
  validateBody(updateStudentSchema),
  asyncHandler((req, res) => studentsController.updateStudent(req, res)),
);

studentsRoutes.delete(
  '/students/:id',
  requirePermissions([PERMISSIONS.STUDENTS_MANAGE]),
  asyncHandler((req, res) => studentsController.deleteStudent(req, res)),
);

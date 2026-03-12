import { Router } from 'express';

import { authenticate } from '../../common/middleware/authenticate.middleware';
import {
  requireAnyPermissions,
  requirePermissions,
} from '../../common/middleware/require-permissions.middleware';
import { enforceTenant } from '../../common/middleware/tenant.middleware';
import { validateBody } from '../../common/middleware/validate.middleware';
import { asyncHandler } from '../../common/utils/async-handler';
import { PERMISSIONS } from '../../constants/permissions';
import { AcademicsController } from './academic.controller';
import {
  createAcademicYearSchema,
  createClassRoomSchema,
  createGradeLevelSchema,
  createSubjectSchema,
  createTermSchema,
  updateAcademicYearSchema,
  updateClassRoomSchema,
  updateGradeLevelSchema,
  updateSubjectSchema,
  updateTermSchema,
} from './academic.schemas';

const academicsController = new AcademicsController();

export const academicRoutes = Router();

academicRoutes.use(authenticate, enforceTenant);

academicRoutes.post(
  '/academic-years',
  requirePermissions([PERMISSIONS.ACADEMIC_YEAR_MANAGE]),
  validateBody(createAcademicYearSchema),
  asyncHandler((req, res) => academicsController.createAcademicYear(req, res)),
);

academicRoutes.get(
  '/academic-years',
  requireAnyPermissions([
    PERMISSIONS.ACADEMIC_YEAR_MANAGE,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.STUDENT_MY_COURSES_READ,
  ]),
  asyncHandler((req, res) => academicsController.listAcademicYears(req, res)),
);

academicRoutes.patch(
  '/academic-years/:id',
  requirePermissions([PERMISSIONS.ACADEMIC_YEAR_MANAGE]),
  validateBody(updateAcademicYearSchema),
  asyncHandler((req, res) => academicsController.updateAcademicYear(req, res)),
);

academicRoutes.delete(
  '/academic-years/:id',
  requirePermissions([PERMISSIONS.ACADEMIC_YEAR_MANAGE]),
  asyncHandler((req, res) => academicsController.deleteAcademicYear(req, res)),
);

academicRoutes.post(
  '/terms',
  requirePermissions([PERMISSIONS.TERM_MANAGE]),
  validateBody(createTermSchema),
  asyncHandler((req, res) => academicsController.createTerm(req, res)),
);

academicRoutes.get(
  '/terms',
  requireAnyPermissions([
    PERMISSIONS.TERM_MANAGE,
    PERMISSIONS.EXAMS_READ,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.REPORT_CARDS_READ,
    PERMISSIONS.TIMETABLE_READ,
  ]),
  asyncHandler((req, res) => academicsController.listTerms(req, res)),
);

academicRoutes.patch(
  '/terms/:id',
  requirePermissions([PERMISSIONS.TERM_MANAGE]),
  validateBody(updateTermSchema),
  asyncHandler((req, res) => academicsController.updateTerm(req, res)),
);

academicRoutes.delete(
  '/terms/:id',
  requirePermissions([PERMISSIONS.TERM_MANAGE]),
  asyncHandler((req, res) => academicsController.deleteTerm(req, res)),
);

academicRoutes.post(
  '/grade-levels',
  requirePermissions([PERMISSIONS.GRADE_LEVEL_MANAGE]),
  validateBody(createGradeLevelSchema),
  asyncHandler((req, res) => academicsController.createGradeLevel(req, res)),
);

academicRoutes.get(
  '/grade-levels',
  requirePermissions([PERMISSIONS.GRADE_LEVEL_MANAGE]),
  asyncHandler((req, res) => academicsController.listGradeLevels(req, res)),
);

academicRoutes.patch(
  '/grade-levels/:id',
  requirePermissions([PERMISSIONS.GRADE_LEVEL_MANAGE]),
  validateBody(updateGradeLevelSchema),
  asyncHandler((req, res) => academicsController.updateGradeLevel(req, res)),
);

academicRoutes.delete(
  '/grade-levels/:id',
  requirePermissions([PERMISSIONS.GRADE_LEVEL_MANAGE]),
  asyncHandler((req, res) => academicsController.deleteGradeLevel(req, res)),
);

academicRoutes.post(
  '/classes',
  requirePermissions([PERMISSIONS.CLASS_ROOM_MANAGE]),
  validateBody(createClassRoomSchema),
  asyncHandler((req, res) => academicsController.createClassRoom(req, res)),
);

academicRoutes.get(
  '/classes',
  requireAnyPermissions([
    PERMISSIONS.CLASS_ROOM_MANAGE,
    PERMISSIONS.COURSES_MANAGE,
    PERMISSIONS.PARENTS_MANAGE,
  ]),
  asyncHandler((req, res) => academicsController.listClassRooms(req, res)),
);

academicRoutes.patch(
  '/classes/:id',
  requirePermissions([PERMISSIONS.CLASS_ROOM_MANAGE]),
  validateBody(updateClassRoomSchema),
  asyncHandler((req, res) => academicsController.updateClassRoom(req, res)),
);

academicRoutes.delete(
  '/classes/:id',
  requirePermissions([PERMISSIONS.CLASS_ROOM_MANAGE]),
  asyncHandler((req, res) => academicsController.deleteClassRoom(req, res)),
);

academicRoutes.post(
  '/subjects',
  requirePermissions([PERMISSIONS.SUBJECT_MANAGE]),
  validateBody(createSubjectSchema),
  asyncHandler((req, res) => academicsController.createSubject(req, res)),
);

academicRoutes.get(
  '/subjects',
  requireAnyPermissions([PERMISSIONS.SUBJECT_MANAGE, PERMISSIONS.COURSES_MANAGE]),
  asyncHandler((req, res) => academicsController.listSubjects(req, res)),
);

academicRoutes.patch(
  '/subjects/:id',
  requirePermissions([PERMISSIONS.SUBJECT_MANAGE]),
  validateBody(updateSubjectSchema),
  asyncHandler((req, res) => academicsController.updateSubject(req, res)),
);

academicRoutes.delete(
  '/subjects/:id',
  requirePermissions([PERMISSIONS.SUBJECT_MANAGE]),
  asyncHandler((req, res) => academicsController.deleteSubject(req, res)),
);

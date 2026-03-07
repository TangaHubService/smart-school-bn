import { Request, Response } from 'express';

import { sendSuccess } from '../../common/utils/response';
import { LmsService } from './lms.service';
import {
  assignCourseTeacherSchema,
  assignTeacherBySubjectSchema,
  listAssignmentsQuerySchema,
  courseDetailQuerySchema,
  listAssignmentSubmissionsQuerySchema,
  listCoursesQuerySchema,
  listCourseTeacherOptionsQuerySchema,
  listCourseSubjectOptionsQuerySchema,
  listMyCoursesQuerySchema,
} from './lms.schemas';

const lmsService = new LmsService();

function buildContext(req: Request) {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
  };
}

export class LmsController {
  async createCourse(req: Request, res: Response): Promise<Response> {
    const result = await lmsService.createCourse(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listCourses(req: Request, res: Response): Promise<Response> {
    const query = listCoursesQuerySchema.parse(req.query);
    const result = await lmsService.listCourses(req.tenantId!, query, req.user!);

    return sendSuccess(req, res, result);
  }

  async listTeacherOptions(req: Request, res: Response): Promise<Response> {
    const query = listCourseTeacherOptionsQuerySchema.parse(req.query);
    const result = await lmsService.listTeacherOptions(req.tenantId!, query, req.user!);

    return sendSuccess(req, res, result);
  }

  async listSubjectOptions(req: Request, res: Response): Promise<Response> {
    const query = listCourseSubjectOptionsQuerySchema.parse(req.query);
    const result = await lmsService.listSubjectOptions(req.tenantId!, query, req.user!);

    return sendSuccess(req, res, result);
  }

  async assignCourseTeacher(req: Request, res: Response): Promise<Response> {
    const input = assignCourseTeacherSchema.parse(req.body);
    const result = await lmsService.assignCourseTeacher(
      req.tenantId!,
      req.params.courseId,
      input,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async assignTeacherBySubject(req: Request, res: Response): Promise<Response> {
    const input = assignTeacherBySubjectSchema.parse(req.body);
    const result = await lmsService.assignTeacherBySubject(
      req.tenantId!,
      input,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async getCourseDetail(req: Request, res: Response): Promise<Response> {
    const query = courseDetailQuerySchema.parse(req.query);
    const result = await lmsService.getCourseDetail(
      req.tenantId!,
      req.params.courseId,
      query,
      req.user!,
    );

    return sendSuccess(req, res, result);
  }

  async createLesson(req: Request, res: Response): Promise<Response> {
    const result = await lmsService.createLesson(
      req.tenantId!,
      req.params.courseId,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async publishLesson(req: Request, res: Response): Promise<Response> {
    const result = await lmsService.publishLesson(
      req.tenantId!,
      req.params.lessonId,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async createAssignment(req: Request, res: Response): Promise<Response> {
    const result = await lmsService.createAssignment(
      req.tenantId!,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async listAssignments(req: Request, res: Response): Promise<Response> {
    const query = listAssignmentsQuerySchema.parse(req.query);
    const result = await lmsService.listAssignments(req.tenantId!, query, req.user!);

    return sendSuccess(req, res, result);
  }

  async listAssignmentSubmissions(req: Request, res: Response): Promise<Response> {
    const query = listAssignmentSubmissionsQuerySchema.parse(req.query);
    const result = await lmsService.listAssignmentSubmissions(
      req.tenantId!,
      req.params.id,
      query,
      req.user!,
    );

    return sendSuccess(req, res, result);
  }

  async submitAssignment(req: Request, res: Response): Promise<Response> {
    const result = await lmsService.submitAssignment(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result, 201);
  }

  async gradeSubmission(req: Request, res: Response): Promise<Response> {
    const result = await lmsService.gradeSubmission(
      req.tenantId!,
      req.params.id,
      req.body,
      req.user!,
      buildContext(req),
    );

    return sendSuccess(req, res, result);
  }

  async listMyCourses(req: Request, res: Response): Promise<Response> {
    const query = listMyCoursesQuerySchema.parse(req.query);
    const result = await lmsService.listMyCourses(req.tenantId!, req.user!, query);

    return sendSuccess(req, res, result);
  }
}

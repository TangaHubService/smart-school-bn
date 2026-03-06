import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  CreateAcademicYearInput,
  CreateClassRoomInput,
  CreateGradeLevelInput,
  CreateSubjectInput,
  CreateTermInput,
  ListTermsQueryInput,
  UpdateAcademicYearInput,
  UpdateClassRoomInput,
  UpdateGradeLevelInput,
  UpdateSubjectInput,
  UpdateTermInput,
} from './academic.schemas';

export class AcademicsService {
  private readonly auditService = new AuditService();

  async createAcademicYear(
    tenantId: string,
    input: CreateAcademicYearInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.ensureStartBeforeEnd(input.startDate, input.endDate, 'Academic year');

    try {
      const created = await prisma.$transaction(async (tx) => {
        if (input.isCurrent) {
          await tx.academicYear.updateMany({
            where: { tenantId, isCurrent: true },
            data: { isCurrent: false },
          });
        }

        return tx.academicYear.create({
          data: {
            tenantId,
            name: input.name,
            startDate: new Date(input.startDate),
            endDate: new Date(input.endDate),
            isCurrent: input.isCurrent,
            isActive: true,
          },
        });
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.ACADEMIC_YEAR_CREATED,
        entity: 'AcademicYear',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return created;
    } catch (error) {
      this.handleUniqueError(error, 'Academic year already exists');
      throw error;
    }
  }

  async listAcademicYears(tenantId: string) {
    return prisma.academicYear.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ startDate: 'desc' }],
    });
  }

  async updateAcademicYear(
    tenantId: string,
    id: string,
    input: UpdateAcademicYearInput,
  ) {
    const existing = await prisma.academicYear.findFirst({
      where: { id, tenantId, isActive: true },
    });
    if (!existing) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    const startDate = input.startDate ?? existing.startDate.toISOString();
    const endDate = input.endDate ?? existing.endDate.toISOString();
    this.ensureStartBeforeEnd(startDate, endDate, 'Academic year');

    return prisma.$transaction(async (tx) => {
      if (input.isCurrent) {
        await tx.academicYear.updateMany({
          where: { tenantId, isCurrent: true, NOT: { id } },
          data: { isCurrent: false },
        });
      }

      return tx.academicYear.update({
        where: { id },
        data: {
          name: input.name,
          startDate: input.startDate ? new Date(input.startDate) : undefined,
          endDate: input.endDate ? new Date(input.endDate) : undefined,
          isCurrent: input.isCurrent,
          isActive: input.isCurrent === false ? true : undefined,
        },
      });
    });
  }

  async deleteAcademicYear(tenantId: string, id: string) {
    const result = await prisma.$transaction(async (tx) => {
      const yearResult = await tx.academicYear.updateMany({
        where: { id, tenantId, isActive: true },
        data: {
          isActive: false,
          isCurrent: false,
        },
      });

      if (!yearResult.count) {
        return { yearCount: 0 };
      }

      await tx.term.updateMany({
        where: { tenantId, academicYearId: id, isActive: true },
        data: { isActive: false },
      });

      return { yearCount: yearResult.count };
    });

    if (!result.yearCount) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    return { deleted: true };
  }

  async createTerm(
    tenantId: string,
    input: CreateTermInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.ensureStartBeforeEnd(input.startDate, input.endDate, 'Term');

    const academicYear = await prisma.academicYear.findFirst({
      where: {
        id: input.academicYearId,
        tenantId,
        isActive: true,
      },
    });

    if (!academicYear) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    if (
      new Date(input.startDate) < academicYear.startDate ||
      new Date(input.endDate) > academicYear.endDate
    ) {
      throw new AppError(
        400,
        'TERM_OUTSIDE_ACADEMIC_YEAR',
        'Term dates must be within the academic year date range',
      );
    }

    try {
      const created = await prisma.term.create({
        data: {
          tenantId,
          academicYearId: input.academicYearId,
          name: input.name,
          sequence: input.sequence,
          startDate: new Date(input.startDate),
          endDate: new Date(input.endDate),
          isActive: true,
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.TERM_CREATED,
        entity: 'Term',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return created;
    } catch (error) {
      this.handleUniqueError(error, 'Term name or sequence already exists');
      throw error;
    }
  }

  async listTerms(tenantId: string, query: ListTermsQueryInput) {
    return prisma.term.findMany({
      where: {
        tenantId,
        academicYearId: query.academicYearId,
        isActive: true,
      },
      orderBy: [{ academicYearId: 'asc' }, { sequence: 'asc' }],
    });
  }

  async updateTerm(tenantId: string, id: string, input: UpdateTermInput) {
    const existing = await prisma.term.findFirst({
      where: { id, tenantId, isActive: true },
      include: { academicYear: true },
    });

    if (!existing) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const startDate = input.startDate ?? existing.startDate.toISOString();
    const endDate = input.endDate ?? existing.endDate.toISOString();
    this.ensureStartBeforeEnd(startDate, endDate, 'Term');

    if (
      new Date(startDate) < existing.academicYear.startDate ||
      new Date(endDate) > existing.academicYear.endDate
    ) {
      throw new AppError(
        400,
        'TERM_OUTSIDE_ACADEMIC_YEAR',
        'Term dates must be within the academic year date range',
      );
    }

    return prisma.term.update({
      where: { id },
      data: {
        name: input.name,
        sequence: input.sequence,
        startDate: input.startDate ? new Date(input.startDate) : undefined,
        endDate: input.endDate ? new Date(input.endDate) : undefined,
        isActive: input.isActive,
      },
    });
  }

  async deleteTerm(tenantId: string, id: string) {
    const result = await prisma.term.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });
    if (!result.count) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    return { deleted: true };
  }

  async createGradeLevel(
    tenantId: string,
    input: CreateGradeLevelInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    try {
      const created = await prisma.gradeLevel.create({
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          rank: input.rank,
          isActive: true,
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.GRADE_LEVEL_CREATED,
        entity: 'GradeLevel',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return created;
    } catch (error) {
      this.handleUniqueError(error, 'Grade level code or name already exists');
      throw error;
    }
  }

  async listGradeLevels(tenantId: string) {
    return prisma.gradeLevel.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ rank: 'asc' }],
    });
  }

  async updateGradeLevel(tenantId: string, id: string, input: UpdateGradeLevelInput) {
    const result = await prisma.gradeLevel.updateMany({
      where: { id, tenantId, isActive: true },
      data: input,
    });

    if (!result.count) {
      throw new AppError(404, 'GRADE_LEVEL_NOT_FOUND', 'Grade level not found');
    }

    return prisma.gradeLevel.findUnique({ where: { id } });
  }

  async deleteGradeLevel(tenantId: string, id: string) {
    const result = await prisma.$transaction(async (tx) => {
      const gradeResult = await tx.gradeLevel.updateMany({
        where: { id, tenantId, isActive: true },
        data: { isActive: false },
      });

      if (!gradeResult.count) {
        return { gradeCount: 0 };
      }

      await tx.classRoom.updateMany({
        where: { tenantId, gradeLevelId: id, isActive: true },
        data: { isActive: false },
      });

      return { gradeCount: gradeResult.count };
    });

    if (!result.gradeCount) {
      throw new AppError(404, 'GRADE_LEVEL_NOT_FOUND', 'Grade level not found');
    }

    return { deleted: true };
  }

  async createClassRoom(
    tenantId: string,
    input: CreateClassRoomInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const gradeLevel = await prisma.gradeLevel.findFirst({
      where: { id: input.gradeLevelId, tenantId, isActive: true },
    });

    if (!gradeLevel) {
      throw new AppError(404, 'GRADE_LEVEL_NOT_FOUND', 'Grade level not found');
    }

    try {
      const created = await prisma.classRoom.create({
        data: {
          tenantId,
          gradeLevelId: input.gradeLevelId,
          code: input.code,
          name: input.name,
          capacity: input.capacity,
          isActive: true,
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.CLASS_ROOM_CREATED,
        entity: 'ClassRoom',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return created;
    } catch (error) {
      this.handleUniqueError(error, 'Class code or name already exists in this level');
      throw error;
    }
  }

  async listClassRooms(tenantId: string) {
    return prisma.classRoom.findMany({
      where: {
        tenantId,
        isActive: true,
        gradeLevel: { isActive: true },
      },
      include: { gradeLevel: true },
      orderBy: [{ gradeLevel: { rank: 'asc' } }, { name: 'asc' }],
    });
  }

  async updateClassRoom(tenantId: string, id: string, input: UpdateClassRoomInput) {
    if (input.gradeLevelId) {
      const gradeLevel = await prisma.gradeLevel.findFirst({
        where: { id: input.gradeLevelId, tenantId, isActive: true },
      });

      if (!gradeLevel) {
        throw new AppError(404, 'GRADE_LEVEL_NOT_FOUND', 'Grade level not found');
      }
    }

    const result = await prisma.classRoom.updateMany({
      where: { id, tenantId, isActive: true },
      data: {
        gradeLevelId: input.gradeLevelId,
        code: input.code,
        name: input.name,
        capacity: input.capacity,
        isActive: input.isActive,
      },
    });

    if (!result.count) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class room not found');
    }

    return prisma.classRoom.findUnique({ where: { id } });
  }

  async deleteClassRoom(tenantId: string, id: string) {
    const result = await prisma.classRoom.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });
    if (!result.count) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class room not found');
    }

    return { deleted: true };
  }

  async createSubject(
    tenantId: string,
    input: CreateSubjectInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    try {
      const created = await prisma.subject.create({
        data: {
          tenantId,
          code: input.code,
          name: input.name,
          description: input.description,
          isCore: input.isCore,
          isActive: true,
        },
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.SUBJECT_CREATED,
        entity: 'Subject',
        entityId: created.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
      });

      return created;
    } catch (error) {
      this.handleUniqueError(error, 'Subject code or name already exists');
      throw error;
    }
  }

  async listSubjects(tenantId: string) {
    return prisma.subject.findMany({
      where: { tenantId, isActive: true },
      orderBy: [{ isCore: 'desc' }, { name: 'asc' }],
    });
  }

  async updateSubject(tenantId: string, id: string, input: UpdateSubjectInput) {
    const result = await prisma.subject.updateMany({
      where: { id, tenantId, isActive: true },
      data: {
        code: input.code,
        name: input.name,
        description: input.description === null ? null : input.description,
        isCore: input.isCore,
        isActive: input.isActive,
      },
    });

    if (!result.count) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found');
    }

    return prisma.subject.findUnique({ where: { id } });
  }

  async deleteSubject(tenantId: string, id: string) {
    const result = await prisma.subject.updateMany({
      where: { id, tenantId, isActive: true },
      data: { isActive: false },
    });
    if (!result.count) {
      throw new AppError(404, 'SUBJECT_NOT_FOUND', 'Subject not found');
    }

    return { deleted: true };
  }

  private ensureStartBeforeEnd(startDate: string, endDate: string, label: string) {
    if (!(new Date(startDate) < new Date(endDate))) {
      throw new AppError(
        400,
        `${label.toUpperCase().replace(/\s+/g, '_')}_INVALID_DATES`,
        `${label} startDate must be earlier than endDate`,
      );
    }
  }

  private handleUniqueError(error: unknown, message: string): never | void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError(409, 'UNIQUE_CONSTRAINT_VIOLATION', message, error.meta);
    }
  }
}

import {
  ConductIncidentStatus,
  ConductSeverity,
  Prisma,
} from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  conductIncidentInclude,
  mapConductIncident,
} from './conduct.shared';
import {
  AddConductActionInput,
  CreateConductIncidentInput,
  ListConductIncidentsQueryInput,
  ResolveConductIncidentInput,
  StudentConductProfileQueryInput,
  UpdateConductIncidentInput,
} from './conduct.schemas';

const studentProfileSelect = {
  id: true,
  studentCode: true,
  firstName: true,
  lastName: true,
  gender: true,
  dateOfBirth: true,
  enrollments: {
    where: { isActive: true },
    orderBy: { enrolledAt: 'desc' },
    take: 1,
    select: {
      id: true,
      enrolledAt: true,
      academicYear: {
        select: {
          id: true,
          name: true,
        },
      },
      classRoom: {
        select: {
          id: true,
          code: true,
          name: true,
        },
      },
    },
  },
} satisfies Prisma.StudentSelect;

export class ConductService {
  private readonly auditService = new AuditService();

  async createIncident(
    tenantId: string,
    input: CreateConductIncidentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const student = await this.getStudentForTenant(tenantId, input.studentId);
    const classRoomId =
      input.classRoomId ?? student.enrollments[0]?.classRoom.id ?? null;

    if (input.classRoomId) {
      await this.ensureClassRoomExists(tenantId, input.classRoomId);
    }

    const created = await prisma.conductIncident.create({
      data: {
        tenantId,
        studentId: input.studentId,
        classRoomId,
        reportedByUserId: actor.sub,
        occurredAt: new Date(input.occurredAt),
        category: input.category,
        title: input.title,
        description: input.description,
        severity: input.severity ?? ConductSeverity.MODERATE,
        location: input.location,
        reporterNotes: input.reporterNotes,
      },
      include: conductIncidentInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_INCIDENT_CREATED,
      entity: 'ConductIncident',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        studentId: created.studentId,
        classRoomId: created.classRoomId,
        severity: created.severity,
        status: created.status,
      },
    });

    return mapConductIncident(created, 'school');
  }

  async listIncidents(tenantId: string, query: ListConductIncidentsQueryInput) {
    const where = this.buildIncidentWhere(tenantId, query);
    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, incidents] = await prisma.$transaction([
      prisma.conductIncident.count({ where }),
      prisma.conductIncident.findMany({
        where,
        skip,
        take: query.pageSize,
        include: conductIncidentInclude,
        orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      items: incidents.map((incident) => mapConductIncident(incident, 'school')),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async getIncidentDetail(tenantId: string, incidentId: string) {
    const incident = await this.getIncidentOrThrow({
      id: incidentId,
      tenantId,
    });

    return mapConductIncident(incident, 'school');
  }

  async updateIncident(
    tenantId: string,
    incidentId: string,
    input: UpdateConductIncidentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    if (input.status === ConductIncidentStatus.RESOLVED) {
      throw new AppError(
        400,
        'CONDUCT_USE_RESOLVE_ENDPOINT',
        'Use the resolve endpoint to mark an incident as resolved',
      );
    }

    await this.ensureIncidentExists(tenantId, incidentId);

    const updated = await prisma.conductIncident.update({
      where: { id: incidentId },
      data: {
        category: input.category,
        title: input.title,
        description: input.description,
        severity: input.severity,
        status: input.status,
        occurredAt: input.occurredAt ? new Date(input.occurredAt) : undefined,
        location:
          input.location === null ? null : input.location ?? undefined,
        reporterNotes:
          input.reporterNotes === null
            ? null
            : input.reporterNotes ?? undefined,
      },
      include: conductIncidentInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_INCIDENT_UPDATED,
      entity: 'ConductIncident',
      entityId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        updatedFields: Object.keys(input),
        status: updated.status,
        severity: updated.severity,
      },
    });

    return mapConductIncident(updated, 'school');
  }

  async addAction(
    tenantId: string,
    incidentId: string,
    input: AddConductActionInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    await this.ensureIncidentExists(tenantId, incidentId);

    await prisma.conductAction.create({
      data: {
        tenantId,
        incidentId,
        createdByUserId: actor.sub,
        type: input.type,
        title: input.title,
        description: input.description,
        actionDate: new Date(input.actionDate),
        dueDate: input.dueDate ? new Date(input.dueDate) : null,
        completedAt: input.completedAt ? new Date(input.completedAt) : null,
      },
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_ACTION_ADDED,
      entity: 'ConductIncident',
      entityId: incidentId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        actionType: input.type,
        title: input.title,
      },
    });

    return this.getIncidentDetail(tenantId, incidentId);
  }

  async resolveIncident(
    tenantId: string,
    incidentId: string,
    input: ResolveConductIncidentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    await this.ensureIncidentExists(tenantId, incidentId);

    const resolved = await prisma.conductIncident.update({
      where: { id: incidentId },
      data: {
        status: ConductIncidentStatus.RESOLVED,
        resolutionSummary: input.resolutionSummary,
        resolvedAt: new Date(),
        resolvedByUserId: actor.sub,
      },
      include: conductIncidentInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_INCIDENT_RESOLVED,
      entity: 'ConductIncident',
      entityId: resolved.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        resolutionSummary: input.resolutionSummary,
      },
    });

    return mapConductIncident(resolved, 'school');
  }

  async getStudentConductProfile(
    tenantId: string,
    studentId: string,
    query: StudentConductProfileQueryInput,
  ) {
    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        tenantId,
        deletedAt: null,
      },
      select: studentProfileSelect,
    });

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    const skip = (query.page - 1) * query.pageSize;

    const [totalIncidents, openIncidents, resolvedIncidents, actionItems, incidents] =
      await prisma.$transaction([
        prisma.conductIncident.count({
          where: { tenantId, studentId },
        }),
        prisma.conductIncident.count({
          where: {
            tenantId,
            studentId,
            status: { not: ConductIncidentStatus.RESOLVED },
          },
        }),
        prisma.conductIncident.count({
          where: {
            tenantId,
            studentId,
            status: ConductIncidentStatus.RESOLVED,
          },
        }),
        prisma.conductAction.count({
          where: {
            tenantId,
            incident: {
              studentId,
            },
          },
        }),
        prisma.conductIncident.findMany({
          where: { tenantId, studentId },
          skip,
          take: query.pageSize,
          include: conductIncidentInclude,
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        }),
      ]);

    const currentEnrollment = student.enrollments[0];

    return {
      student: {
        id: student.id,
        studentCode: student.studentCode,
        firstName: student.firstName,
        lastName: student.lastName,
        gender: student.gender,
        dateOfBirth: student.dateOfBirth,
        currentEnrollment: currentEnrollment
          ? {
              id: currentEnrollment.id,
              enrolledAt: currentEnrollment.enrolledAt,
              academicYear: currentEnrollment.academicYear,
              classRoom: currentEnrollment.classRoom,
            }
          : null,
      },
      summary: {
        totalIncidents,
        openIncidents,
        resolvedIncidents,
        actionItems,
      },
      incidents: incidents.map((incident) => mapConductIncident(incident, 'school')),
      pagination: buildPagination(query.page, query.pageSize, totalIncidents),
    };
  }

  private buildIncidentWhere(
    tenantId: string,
    query: ListConductIncidentsQueryInput,
  ): Prisma.ConductIncidentWhereInput {
    const where: Prisma.ConductIncidentWhereInput = {
      tenantId,
    };

    if (query.studentId) {
      where.studentId = query.studentId;
    }

    if (query.classRoomId) {
      where.classRoomId = query.classRoomId;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.severity) {
      where.severity = query.severity;
    }

    if (query.q) {
      where.OR = [
        {
          category: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          title: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          description: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          student: {
            firstName: {
              contains: query.q,
              mode: 'insensitive',
            },
          },
        },
        {
          student: {
            lastName: {
              contains: query.q,
              mode: 'insensitive',
            },
          },
        },
        {
          student: {
            studentCode: {
              contains: query.q,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    return where;
  }

  private async getStudentForTenant(tenantId: string, studentId: string) {
    const student = await prisma.student.findFirst({
      where: {
        id: studentId,
        tenantId,
        deletedAt: null,
      },
      select: studentProfileSelect,
    });

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    return student;
  }

  private async ensureClassRoomExists(tenantId: string, classRoomId: string) {
    const classRoom = await prisma.classRoom.findFirst({
      where: {
        id: classRoomId,
        tenantId,
      },
      select: { id: true },
    });

    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class not found');
    }
  }

  private async ensureIncidentExists(tenantId: string, incidentId: string) {
    const incident = await prisma.conductIncident.findFirst({
      where: {
        id: incidentId,
        tenantId,
      },
      select: { id: true },
    });

    if (!incident) {
      throw new AppError(404, 'CONDUCT_INCIDENT_NOT_FOUND', 'Conduct incident not found');
    }
  }

  private async getIncidentOrThrow(where: Prisma.ConductIncidentWhereInput) {
    const incident = await prisma.conductIncident.findFirst({
      where,
      include: conductIncidentInclude,
    });

    if (!incident) {
      throw new AppError(404, 'CONDUCT_INCIDENT_NOT_FOUND', 'Conduct incident not found');
    }

    return incident;
  }
}

import {
  ConductIncidentStatus,
  ConductMarkMethod,
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
  ListConductMarksQueryInput,
  LockConductMarkInput,
  RecalculateConductMarkInput,
  ResolveConductIncidentInput,
  StudentConductProfileQueryInput,
  UpdateConductIncidentInput,
  UpdateConductMarkInput,
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

const conductMarkInclude = {
  student: {
    select: {
      id: true,
      studentCode: true,
      firstName: true,
      lastName: true,
    },
  },
  term: {
    select: {
      id: true,
      name: true,
      sequence: true,
      academicYear: {
        select: {
          id: true,
          name: true,
        },
      },
    },
  },
  updatedByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  lockedByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
} satisfies Prisma.ConductMarkInclude;

type ConductMarkRecord = Prisma.ConductMarkGetPayload<{
  include: typeof conductMarkInclude;
}>;

function mapConductMark(mark: ConductMarkRecord) {
  return {
    id: mark.id,
    tenantId: mark.tenantId,
    studentId: mark.studentId,
    termId: mark.termId,
    score: mark.score,
    maxScore: mark.maxScore,
    isLocked: mark.isLocked,
    computedFromIncidents: mark.computedFromIncidents,
    overrideReason: mark.overrideReason,
    lockedAt: mark.lockedAt,
    createdAt: mark.createdAt,
    updatedAt: mark.updatedAt,
    student: mark.student,
    term: mark.term,
    updatedBy: mark.updatedByUser
      ? {
          id: mark.updatedByUser.id,
          firstName: mark.updatedByUser.firstName,
          lastName: mark.updatedByUser.lastName,
        }
      : null,
    lockedBy: mark.lockedByUser
      ? {
          id: mark.lockedByUser.id,
          firstName: mark.lockedByUser.firstName,
          lastName: mark.lockedByUser.lastName,
        }
      : null,
  };
}

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
    const occurredAt = new Date(input.occurredAt);

    if (input.classRoomId) {
      await this.ensureClassRoomExists(tenantId, input.classRoomId);
    }

    if (Number.isNaN(occurredAt.getTime())) {
      throw new AppError(400, 'CONDUCT_OCCURRED_AT_INVALID', 'occurredAt is invalid');
    }

    let termId: string | null = null;
    if (input.termId) {
      const term = await this.ensureTermForTenant(tenantId, input.termId);
      termId = term.id;
    } else {
      termId = await this.resolveTermIdForDate(tenantId, occurredAt);
    }

    const created = await prisma.conductIncident.create({
      data: {
        tenantId,
        studentId: input.studentId,
        termId,
        classRoomId,
        reportedByUserId: actor.sub,
        occurredAt,
        category: input.category,
        title: input.title,
        description: input.description,
        deductionPoints: input.deductionPoints ?? 0,
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
        termId: created.termId,
        classRoomId: created.classRoomId,
        severity: created.severity,
        status: created.status,
        deductionPoints: created.deductionPoints,
      },
    });

    await this.maybeAutoRecalculateMarkFromIncident(
      tenantId,
      created.studentId,
      created.termId,
      actor,
      context,
      'incident.created',
    );

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

    const existing = await this.getIncidentBaseOrThrow(tenantId, incidentId);

    if (input.termId) {
      await this.ensureTermForTenant(tenantId, input.termId);
    }

    const updated = await prisma.conductIncident.update({
      where: { id: incidentId },
      data: {
        termId:
          input.termId === null
            ? null
            : input.termId ?? undefined,
        category: input.category,
        title: input.title,
        description: input.description,
        deductionPoints: input.deductionPoints,
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
        termId: updated.termId,
        status: updated.status,
        severity: updated.severity,
        deductionPoints: updated.deductionPoints,
      },
    });

    if (existing.termId && existing.termId !== updated.termId) {
      await this.maybeAutoRecalculateMarkFromIncident(
        tenantId,
        updated.studentId,
        existing.termId,
        actor,
        context,
        'incident.updated.previous_term',
      );
    }

    await this.maybeAutoRecalculateMarkFromIncident(
      tenantId,
      updated.studentId,
      updated.termId,
      actor,
      context,
      'incident.updated',
    );

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
    const incidentWhere: Prisma.ConductIncidentWhereInput = {
      tenantId,
      studentId,
      ...(query.termId ? { termId: query.termId } : {}),
    };

    const [totalIncidents, openIncidents, resolvedIncidents, actionItems, incidents] =
      await prisma.$transaction([
        prisma.conductIncident.count({
          where: incidentWhere,
        }),
        prisma.conductIncident.count({
          where: {
            ...incidentWhere,
            status: { not: ConductIncidentStatus.RESOLVED },
          },
        }),
        prisma.conductIncident.count({
          where: {
            ...incidentWhere,
            status: ConductIncidentStatus.RESOLVED,
          },
        }),
        prisma.conductAction.count({
          where: {
            tenantId,
            incident: {
              studentId,
              ...(query.termId ? { termId: query.termId } : {}),
            },
          },
        }),
        prisma.conductIncident.findMany({
          where: incidentWhere,
          skip,
          take: query.pageSize,
          include: conductIncidentInclude,
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        }),
      ]);

    let conductMark: ReturnType<typeof mapConductMark> | null = null;
    let termMarks: ReturnType<typeof mapConductMark>[] = [];

    if (this.isConductMarksRuntimeReady()) {
      if (query.termId) {
        const mark = await prisma.conductMark.findUnique({
          where: {
            tenantId_studentId_termId: {
              tenantId,
              studentId,
              termId: query.termId,
            },
          },
          include: conductMarkInclude,
        });

        if (mark) {
          conductMark = mapConductMark(mark);
        } else {
          const config = await this.getConductConfig(tenantId);
          const deductionTotal = await this.getTermDeductionTotal(
            tenantId,
            studentId,
            query.termId,
          );
          conductMark = {
            id: null,
            tenantId,
            studentId,
            termId: query.termId,
            score:
              config.method === ConductMarkMethod.DEDUCT
                ? Math.max(0, config.maxScore - deductionTotal)
                : config.maxScore,
            maxScore: config.maxScore,
            isLocked: false,
            computedFromIncidents: config.method === ConductMarkMethod.DEDUCT,
            overrideReason: null,
            lockedAt: null,
            createdAt: null,
            updatedAt: null,
            student: {
              id: student.id,
              studentCode: student.studentCode,
              firstName: student.firstName,
              lastName: student.lastName,
            },
            term: null,
            updatedBy: null,
            lockedBy: null,
            isProvisional: true,
            deductionPointsTotal: deductionTotal,
          } as any;
        }
      }

      const marks = await prisma.conductMark.findMany({
        where: {
          tenantId,
          studentId,
        },
        include: conductMarkInclude,
        orderBy: [{ term: { startDate: 'desc' } }, { updatedAt: 'desc' }],
        take: 6,
      });
      termMarks = marks.map((mark) => mapConductMark(mark));
    }

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
      conductMark,
      termMarks,
      incidents: incidents.map((incident) => mapConductIncident(incident, 'school')),
      pagination: buildPagination(query.page, query.pageSize, totalIncidents),
    };
  }

  async listMarks(tenantId: string, query: ListConductMarksQueryInput) {
    this.assertConductMarksRuntimeReady();

    if (!query.termId) {
      throw new AppError(400, 'TERM_ID_REQUIRED', 'termId is required');
    }

    const term = await this.ensureTermForTenant(tenantId, query.termId);
    const classRoomId = query.classRoomId ?? query.classId;
    if (classRoomId) {
      await this.ensureClassRoomExists(tenantId, classRoomId);
    }

    const where: Prisma.StudentEnrollmentWhereInput = {
      tenantId,
      academicYearId: term.academicYearId,
      isActive: true,
    };

    if (query.studentId) {
      where.studentId = query.studentId;
    }

    if (classRoomId) {
      where.classRoomId = classRoomId;
    }

    if (query.q) {
      where.OR = [
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

    const skip = (query.page - 1) * query.pageSize;
    const [totalItems, enrollments, config] = await prisma.$transaction([
      prisma.studentEnrollment.count({ where }),
      prisma.studentEnrollment.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: [{ classRoom: { name: 'asc' } }, { student: { lastName: 'asc' } }],
        select: {
          studentId: true,
          classRoom: {
            select: {
              id: true,
              code: true,
              name: true,
            },
          },
          academicYear: {
            select: {
              id: true,
              name: true,
            },
          },
          student: {
            select: {
              id: true,
              studentCode: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      }),
      prisma.conductConfig.upsert({
        where: { tenantId },
        update: {},
        create: {
          tenantId,
          method: ConductMarkMethod.MANUAL,
          maxScore: 20,
        },
      }),
    ]);

    if (!enrollments.length) {
      return {
        config: {
          method: config.method,
          maxScore: config.maxScore,
        },
        term: {
          id: term.id,
          name: term.name,
          sequence: term.sequence,
        },
        items: [],
        pagination: buildPagination(query.page, query.pageSize, totalItems),
      };
    }

    const studentIds = enrollments.map((item) => item.studentId);
    const [marks, incidentRows] = await prisma.$transaction([
      prisma.conductMark.findMany({
        where: {
          tenantId,
          termId: term.id,
          studentId: { in: studentIds },
        },
        include: conductMarkInclude,
      }),
      prisma.conductIncident.findMany({
        where: {
          tenantId,
          termId: term.id,
          studentId: { in: studentIds },
        },
        select: {
          studentId: true,
          deductionPoints: true,
        },
      }),
    ]);

    const markByStudentId = new Map<string, ConductMarkRecord>();
    for (const mark of marks) {
      markByStudentId.set(mark.studentId, mark);
    }

    const deductionByStudentId = new Map<string, number>();
    for (const row of incidentRows) {
      deductionByStudentId.set(
        row.studentId,
        (deductionByStudentId.get(row.studentId) ?? 0) + row.deductionPoints,
      );
    }

    const items = enrollments.map((enrollment) => {
      const persisted = markByStudentId.get(enrollment.studentId);
      const deductionPointsTotal = deductionByStudentId.get(enrollment.studentId) ?? 0;

      const mark = persisted
        ? mapConductMark(persisted)
        : {
            id: null,
            tenantId,
            studentId: enrollment.student.id,
            termId: term.id,
            score:
              config.method === ConductMarkMethod.DEDUCT
                ? Math.max(0, config.maxScore - deductionPointsTotal)
                : config.maxScore,
            maxScore: config.maxScore,
            isLocked: false,
            computedFromIncidents: config.method === ConductMarkMethod.DEDUCT,
            overrideReason: null,
            lockedAt: null,
            createdAt: null,
            updatedAt: null,
            student: enrollment.student,
            term: {
              id: term.id,
              name: term.name,
              sequence: term.sequence,
              academicYear: {
                id: term.academicYearId,
                name: enrollment.academicYear.name,
              },
            },
            updatedBy: null,
            lockedBy: null,
            isProvisional: true,
          };

      return {
        student: enrollment.student,
        classRoom: enrollment.classRoom,
        academicYear: enrollment.academicYear,
        term: {
          id: term.id,
          name: term.name,
          sequence: term.sequence,
        },
        deductionPointsTotal,
        mark,
      };
    });

    return {
      config: {
        method: config.method,
        maxScore: config.maxScore,
      },
      term: {
        id: term.id,
        name: term.name,
        sequence: term.sequence,
      },
      items,
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async upsertMark(
    tenantId: string,
    studentId: string,
    termId: string,
    input: UpdateConductMarkInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.assertConductMarksRuntimeReady();
    await this.getStudentForTenant(tenantId, studentId);
    await this.ensureTermForTenant(tenantId, termId);

    const existing = await prisma.conductMark.findUnique({
      where: {
        tenantId_studentId_termId: {
          tenantId,
          studentId,
          termId,
        },
      },
      include: conductMarkInclude,
    });

    if (existing?.isLocked) {
      throw new AppError(409, 'CONDUCT_MARK_LOCKED', 'Conduct mark is locked');
    }

    const config = await this.getConductConfig(tenantId);
    const maxScore = input.maxScore ?? existing?.maxScore ?? config.maxScore;
    if (input.score > maxScore) {
      throw new AppError(
        400,
        'CONDUCT_MARK_SCORE_INVALID',
        'score cannot be greater than maxScore',
      );
    }

    if (input.manualOverride && !input.reason) {
      throw new AppError(
        400,
        'CONDUCT_MARK_OVERRIDE_REASON_REQUIRED',
        'reason is required for manual override',
      );
    }

    const saved = existing
      ? await prisma.conductMark.update({
          where: { id: existing.id },
          data: {
            score: input.score,
            maxScore,
            computedFromIncidents: false,
            overrideReason: input.reason ?? null,
            updatedByUserId: actor.sub,
          },
          include: conductMarkInclude,
        })
      : await prisma.conductMark.create({
          data: {
            tenantId,
            studentId,
            termId,
            score: input.score,
            maxScore,
            computedFromIncidents: false,
            overrideReason: input.reason ?? null,
            updatedByUserId: actor.sub,
          },
          include: conductMarkInclude,
        });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: input.manualOverride
        ? AUDIT_EVENT.CONDUCT_MARK_MANUAL_OVERRIDE
        : AUDIT_EVENT.CONDUCT_MARK_UPDATED,
      entity: 'ConductMark',
      entityId: saved.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        studentId,
        termId,
        score: saved.score,
        maxScore: saved.maxScore,
        reason: input.reason ?? null,
      },
    });

    return mapConductMark(saved);
  }

  async recalculateMark(
    tenantId: string,
    studentId: string,
    termId: string,
    input: RecalculateConductMarkInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.assertConductMarksRuntimeReady();
    await this.getStudentForTenant(tenantId, studentId);
    await this.ensureTermForTenant(tenantId, termId);

    const existing = await prisma.conductMark.findUnique({
      where: {
        tenantId_studentId_termId: {
          tenantId,
          studentId,
          termId,
        },
      },
      include: conductMarkInclude,
    });

    if (existing?.isLocked) {
      throw new AppError(409, 'CONDUCT_MARK_LOCKED', 'Conduct mark is locked');
    }

    const config = await this.getConductConfig(tenantId);
    const maxScore = input.maxScore ?? existing?.maxScore ?? config.maxScore;
    const deductionTotal = await this.getTermDeductionTotal(
      tenantId,
      studentId,
      termId,
    );
    const score = Math.max(0, maxScore - deductionTotal);

    const saved = existing
      ? await prisma.conductMark.update({
          where: { id: existing.id },
          data: {
            score,
            maxScore,
            computedFromIncidents: true,
            overrideReason: null,
            updatedByUserId: actor.sub,
          },
          include: conductMarkInclude,
        })
      : await prisma.conductMark.create({
          data: {
            tenantId,
            studentId,
            termId,
            score,
            maxScore,
            computedFromIncidents: true,
            overrideReason: null,
            updatedByUserId: actor.sub,
          },
          include: conductMarkInclude,
        });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_MARK_RECALCULATED,
      entity: 'ConductMark',
      entityId: saved.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        studentId,
        termId,
        deductionTotal,
        score,
        maxScore,
        reason: input.reason ?? null,
      },
    });

    return mapConductMark(saved);
  }

  async lockMark(
    tenantId: string,
    studentId: string,
    termId: string,
    input: LockConductMarkInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.assertConductMarksRuntimeReady();
    await this.getStudentForTenant(tenantId, studentId);
    await this.ensureTermForTenant(tenantId, termId);

    const existing = await this.ensureMarkForStudentTerm(
      tenantId,
      studentId,
      termId,
      actor.sub,
    );

    if (existing.isLocked) {
      return mapConductMark(existing);
    }

    const locked = await prisma.conductMark.update({
      where: { id: existing.id },
      data: {
        isLocked: true,
        lockedAt: new Date(),
        lockedByUserId: actor.sub,
        updatedByUserId: actor.sub,
      },
      include: conductMarkInclude,
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_MARK_LOCKED,
      entity: 'ConductMark',
      entityId: locked.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        studentId,
        termId,
        reason: input.reason ?? null,
      },
    });

    return mapConductMark(locked);
  }

  async lockMarksForResultPublication(
    tenantId: string,
    termId: string,
    classRoomId: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    if (!this.isConductMarksRuntimeReady()) {
      return {
        lockedCount: 0,
        skipped: true,
      };
    }

    const term = await this.ensureTermForTenant(tenantId, termId);
    await this.ensureClassRoomExists(tenantId, classRoomId);
    const config = await this.getConductConfig(tenantId);

    const enrollments = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        academicYearId: term.academicYearId,
        classRoomId,
        isActive: true,
      },
      select: {
        studentId: true,
      },
    });

    let lockedCount = 0;

    for (const enrollment of enrollments) {
      const existing = await prisma.conductMark.findUnique({
        where: {
          tenantId_studentId_termId: {
            tenantId,
            studentId: enrollment.studentId,
            termId,
          },
        },
        include: conductMarkInclude,
      });

      if (existing?.isLocked) {
        continue;
      }

      if (existing) {
        await prisma.conductMark.update({
          where: { id: existing.id },
          data: {
            isLocked: true,
            lockedAt: new Date(),
            lockedByUserId: actor.sub,
            updatedByUserId: actor.sub,
          },
        });
        lockedCount += 1;
        continue;
      }

      const deductionTotal = await this.getTermDeductionTotal(
        tenantId,
        enrollment.studentId,
        termId,
      );
      const maxScore = config.maxScore;
      const score =
        config.method === ConductMarkMethod.DEDUCT
          ? Math.max(0, maxScore - deductionTotal)
          : maxScore;

      await prisma.conductMark.create({
        data: {
          tenantId,
          studentId: enrollment.studentId,
          termId,
          score,
          maxScore,
          computedFromIncidents: config.method === ConductMarkMethod.DEDUCT,
          isLocked: true,
          lockedAt: new Date(),
          lockedByUserId: actor.sub,
          updatedByUserId: actor.sub,
        },
      });
      lockedCount += 1;
    }

    if (lockedCount > 0) {
      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.CONDUCT_MARK_LOCKED,
        entity: 'ConductMark',
        entityId: `${termId}:${classRoomId}`,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          termId,
          classRoomId,
          lockedCount,
          autoLockedFromResultsPublish: true,
        },
      });
    }

    return {
      lockedCount,
      skipped: false,
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

    if (query.termId) {
      where.termId = query.termId;
    }

    const classRoomId = query.classRoomId ?? query.classId;
    if (classRoomId) {
      where.classRoomId = classRoomId;
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

  private async ensureTermForTenant(tenantId: string, termId: string) {
    const term = await prisma.term.findFirst({
      where: {
        id: termId,
        tenantId,
      },
      select: {
        id: true,
        name: true,
        sequence: true,
        academicYearId: true,
      },
    });

    if (!term) {
      throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    return term;
  }

  private async resolveTermIdForDate(tenantId: string, occurredAt: Date) {
    const term = await prisma.term.findFirst({
      where: {
        tenantId,
        isActive: true,
        startDate: { lte: occurredAt },
        endDate: { gte: occurredAt },
      },
      orderBy: { startDate: 'desc' },
      select: { id: true },
    });

    return term?.id ?? null;
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

  private async getIncidentBaseOrThrow(tenantId: string, incidentId: string) {
    const incident = await prisma.conductIncident.findFirst({
      where: {
        id: incidentId,
        tenantId,
      },
      select: {
        id: true,
        studentId: true,
        termId: true,
      },
    });

    if (!incident) {
      throw new AppError(404, 'CONDUCT_INCIDENT_NOT_FOUND', 'Conduct incident not found');
    }

    return incident;
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

  private isConductMarksRuntimeReady() {
    const runtimePrisma = prisma as unknown as Record<string, unknown>;
    return Boolean(runtimePrisma.conductMark && runtimePrisma.conductConfig);
  }

  private assertConductMarksRuntimeReady() {
    if (!this.isConductMarksRuntimeReady()) {
      throw new AppError(
        503,
        'CONDUCT_MARK_RUNTIME_RESTART_REQUIRED',
        'Conduct marks are running with an outdated Prisma client. Restart the backend after prisma generate.',
      );
    }
  }

  private async getConductConfig(tenantId: string) {
    this.assertConductMarksRuntimeReady();
    return prisma.conductConfig.upsert({
      where: { tenantId },
      update: {},
      create: {
        tenantId,
        method: ConductMarkMethod.MANUAL,
        maxScore: 20,
      },
    });
  }

  private async getTermDeductionTotal(
    tenantId: string,
    studentId: string,
    termId: string,
  ) {
    const aggregate = await prisma.conductIncident.aggregate({
      where: {
        tenantId,
        studentId,
        termId,
      },
      _sum: {
        deductionPoints: true,
      },
    });

    return aggregate._sum.deductionPoints ?? 0;
  }

  private async ensureMarkForStudentTerm(
    tenantId: string,
    studentId: string,
    termId: string,
    actorUserId: string,
  ) {
    const existing = await prisma.conductMark.findUnique({
      where: {
        tenantId_studentId_termId: {
          tenantId,
          studentId,
          termId,
        },
      },
      include: conductMarkInclude,
    });

    if (existing) {
      return existing;
    }

    const config = await this.getConductConfig(tenantId);
    const deductionTotal = await this.getTermDeductionTotal(tenantId, studentId, termId);
    const score =
      config.method === ConductMarkMethod.DEDUCT
        ? Math.max(0, config.maxScore - deductionTotal)
        : config.maxScore;

    return prisma.conductMark.create({
      data: {
        tenantId,
        studentId,
        termId,
        score,
        maxScore: config.maxScore,
        computedFromIncidents: config.method === ConductMarkMethod.DEDUCT,
        updatedByUserId: actorUserId,
      },
      include: conductMarkInclude,
    });
  }

  private async maybeAutoRecalculateMarkFromIncident(
    tenantId: string,
    studentId: string,
    termId: string | null,
    actor: JwtUser,
    context: RequestAuditContext,
    trigger: string,
  ) {
    if (!termId || !this.isConductMarksRuntimeReady()) {
      return;
    }

    try {
      const config = await this.getConductConfig(tenantId);
      if (config.method !== ConductMarkMethod.DEDUCT) {
        return;
      }

      const existing = await prisma.conductMark.findUnique({
        where: {
          tenantId_studentId_termId: {
            tenantId,
            studentId,
            termId,
          },
        },
        select: {
          id: true,
          isLocked: true,
          maxScore: true,
          computedFromIncidents: true,
          overrideReason: true,
        },
      });

      if (existing?.isLocked) {
        return;
      }

      if (existing && !existing.computedFromIncidents && existing.overrideReason) {
        return;
      }

      const maxScore = existing?.maxScore ?? config.maxScore;
      const deductionTotal = await this.getTermDeductionTotal(tenantId, studentId, termId);
      const score = Math.max(0, maxScore - deductionTotal);

      const saved = existing
        ? await prisma.conductMark.update({
            where: { id: existing.id },
            data: {
              score,
              maxScore,
              computedFromIncidents: true,
              overrideReason: null,
              updatedByUserId: actor.sub,
            },
          })
        : await prisma.conductMark.create({
            data: {
              tenantId,
              studentId,
              termId,
              score,
              maxScore,
              computedFromIncidents: true,
              overrideReason: null,
              updatedByUserId: actor.sub,
            },
          });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.CONDUCT_MARK_RECALCULATED,
        entity: 'ConductMark',
        entityId: saved.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          studentId,
          termId,
          deductionTotal,
          score,
          maxScore,
          auto: true,
          trigger,
        },
      });
    } catch {
      // Keep incident workflows resilient even if mark auto-sync fails.
    }
  }
}

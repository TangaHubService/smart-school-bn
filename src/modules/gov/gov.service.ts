import {
  AuditStatus,
  AuditorLevel,
  ConductFeedbackAuthorType,
  GovScopeLevel,
  Prisma,
} from '@prisma/client';
import bcrypt from 'bcrypt';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { env } from '../../config/env';
import { AUDIT_EVENT } from '../../constants/audit-events';
import {
  GOV_AUDITOR_PERMISSIONS,
} from '../../constants/permissions';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import type { ConductSchoolReportQueryInput } from '../reports/reports.schemas';
import { ReportsOpsService } from '../reports/reports-ops.service';
import {
  conductIncidentInclude,
  mapConductIncident,
} from '../conduct/conduct.shared';
import {
  AddGovFeedbackInput,
  AssignGovAuditorScopeInput,
  CreateGovAuditInput,
  CreateGovAuditorInput,
  ListGovActivityLogsQueryInput,
  ListGovAuditsQueryInput,
  ListGovAuditorsQueryInput,
  ListGovIncidentsQueryInput,
  ListGovReportsQueryInput,
  ListGovSchoolsQueryInput,
  SubmitGovAuditReportInput,
  UpdateGovAuditorInput,
  UpdateGovAuditorScopeInput,
} from './gov.schemas';

type PlatformContext = {
  platformTenantId: string;
  schoolWhere: Prisma.SchoolWhereInput | null;
  isSuperAdmin: boolean;
};

type PrismaExecutor = typeof prisma | Prisma.TransactionClient;

export class GovService {
  private readonly auditService = new AuditService();
  private readonly reportsOps = new ReportsOpsService();

  async createAuditor(
    input: CreateGovAuditorInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const platformTenantId = await this.assertPlatformActor(actor);
    const auditorRole = await this.ensureGovAuditorRole(platformTenantId);
    const profileInput = this.normalizeAuditorProfileInput(input);
    const scopeInput = this.auditorProfileToScope(profileInput);

    const existingUser = await prisma.user.findFirst({
      where: {
        tenantId: platformTenantId,
        email: input.email,
        deletedAt: null,
      },
      select: { id: true },
    });

    if (existingUser) {
      throw new AppError(409, 'GOV_AUDITOR_EXISTS', 'Government auditor already exists');
    }

    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

    const created = await prisma.$transaction(async (tx) => {
      const user = await tx.user.create({
        data: {
          tenantId: platformTenantId,
          email: input.email,
          passwordHash,
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone,
        },
      });

      await tx.userRole.create({
        data: {
          tenantId: platformTenantId,
          userId: user.id,
          roleId: auditorRole.id,
          assignedById: actor.sub,
        },
      });

      await tx.auditor.create({
        data: {
          userId: user.id,
          level: profileInput.level,
          country: profileInput.country,
          province: profileInput.province,
          district: profileInput.district,
          sector: profileInput.sector,
          isActive: true,
        },
      });

      await tx.govAuditorScope.create({
        data: {
          auditorUserId: user.id,
          assignedByUserId: actor.sub,
          scopeLevel: scopeInput.scopeLevel,
          country: scopeInput.country,
          province: scopeInput.province,
          district: scopeInput.district,
          sector: scopeInput.sector,
          notes: null,
        },
      });

      return tx.user.findUniqueOrThrow({
        where: { id: user.id },
        include: {
          govAuditorScopes: {
            orderBy: { createdAt: 'desc' },
            include: {
              assignedByUser: { select: { firstName: true, lastName: true, email: true } },
            },
          },
          auditorProfile: true,
        },
      });
    });

    await this.auditService.log({
      tenantId: platformTenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.GOV_AUDITOR_CREATED,
      module: 'User',
      entity: 'User',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        email: created.email,
        level: profileInput.level,
        country: profileInput.country,
        province: profileInput.province,
        district: profileInput.district,
        sector: profileInput.sector,
      },
    });

    return this.mapAuditor(created);
  }

  async listAuditors(query: ListGovAuditorsQueryInput, actor: JwtUser) {
    const platformTenantId = await this.assertPlatformActor(actor);

    const where: Prisma.UserWhereInput = {
      tenantId: platformTenantId,
      deletedAt: null,
      userRoles: {
        some: {
          role: {
            name: 'GOV_AUDITOR',
          },
        },
      },
    };

    if (query.q) {
      where.OR = [
        {
          firstName: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          lastName: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          email: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
      ];
    }

    const auditors = await prisma.user.findMany({
      where,
      include: {
        govAuditorScopes: {
          orderBy: { createdAt: 'desc' },
          include: {
            assignedByUser: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        auditorProfile: true,
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return {
      items: auditors.map((auditor) => this.mapAuditor(auditor)),
    };
  }

  async updateAuditor(
    auditorUserId: string,
    input: UpdateGovAuditorInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const platformTenantId = await this.assertPlatformActor(actor);
    await this.ensureAuditorUser(platformTenantId, auditorUserId);

    if (actor.sub === auditorUserId && input.status === 'INACTIVE') {
      throw new AppError(400, 'INVALID_STATUS', 'You cannot deactivate your own account');
    }

    const updated = await prisma.user.update({
      where: { id: auditorUserId },
      data: {
        ...(input.firstName !== undefined && { firstName: input.firstName }),
        ...(input.lastName !== undefined && { lastName: input.lastName }),
        ...(input.phone !== undefined && { phone: input.phone }),
        ...(input.status !== undefined && { status: input.status }),
      },
      include: {
        govAuditorScopes: {
          orderBy: { createdAt: 'desc' },
          include: {
            assignedByUser: { select: { firstName: true, lastName: true, email: true } },
          },
        },
        auditorProfile: true,
      },
    });

    if (input.status === 'INACTIVE') {
      await prisma.$transaction([
        prisma.govAuditorScope.updateMany({
          where: {
            auditorUserId,
            isActive: true,
          },
          data: { isActive: false },
        }),
        prisma.auditor.updateMany({
          where: { userId: auditorUserId },
          data: { isActive: false },
        }),
      ]);
    }

    const refreshed = input.status === 'INACTIVE'
      ? await prisma.user.findUniqueOrThrow({
          where: { id: auditorUserId },
          include: {
            govAuditorScopes: {
              orderBy: { createdAt: 'desc' },
              include: {
                assignedByUser: { select: { firstName: true, lastName: true, email: true } },
              },
            },
            auditorProfile: true,
          },
        })
      : updated;

    await this.auditService.log({
      tenantId: platformTenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.GOV_AUDITOR_UPDATED,
      module: 'User',
      entity: 'User',
      entityId: auditorUserId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        updatedFields: Object.keys(input),
      },
    });

    return this.mapAuditor(refreshed);
  }

  async listAuditorScopes(auditorUserId: string, actor: JwtUser) {
    const platformTenantId = await this.assertPlatformActor(actor);
    await this.ensureAuditorUser(platformTenantId, auditorUserId);

    const scopes = await prisma.govAuditorScope.findMany({
      where: {
        auditorUserId,
      },
      include: {
        assignedByUser: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: scopes.map((scope) => this.mapScope(scope)),
    };
  }

  async assignScope(
    auditorUserId: string,
    input: AssignGovAuditorScopeInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const platformTenantId = await this.assertPlatformActor(actor);
    await this.ensureAuditorUser(platformTenantId, auditorUserId);

    const normalized = this.normalizeScope(input);
    const duplicate = await prisma.govAuditorScope.findFirst({
      where: {
        auditorUserId,
        isActive: true,
        scopeLevel: normalized.scopeLevel,
        country: normalized.country,
        province: normalized.province,
        district: normalized.district,
        sector: normalized.sector,
      },
      select: { id: true },
    });

    if (duplicate) {
      throw new AppError(409, 'GOV_SCOPE_EXISTS', 'An active scope already exists for this assignment');
    }

    const scope = await prisma.$transaction(async (tx) => {
      await tx.govAuditorScope.updateMany({
        where: {
          auditorUserId,
          isActive: true,
        },
        data: {
          isActive: false,
        },
      });

      const createdScope = await tx.govAuditorScope.create({
        data: {
          auditorUserId,
          assignedByUserId: actor.sub,
          scopeLevel: normalized.scopeLevel,
          country: normalized.country,
          province: normalized.province,
          district: normalized.district,
          sector: normalized.sector,
          notes: normalized.notes,
          startsAt: normalized.startsAt,
          endsAt: normalized.endsAt,
        },
      });

      await this.syncAuditorProfileFromScope(tx, auditorUserId, createdScope);

      return createdScope;
    });

    await this.auditService.log({
      tenantId: platformTenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.GOV_AUDITOR_SCOPE_ASSIGNED,
      module: 'User',
      entity: 'GovAuditorScope',
      entityId: scope.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        auditorUserId,
        scopeLevel: scope.scopeLevel,
        country: scope.country,
        province: scope.province,
        district: scope.district,
        sector: scope.sector,
      },
    });

    return this.mapScope(scope);
  }

  async updateScope(
    scopeId: string,
    input: UpdateGovAuditorScopeInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const platformTenantId = await this.assertPlatformActor(actor);

    const existing = await prisma.govAuditorScope.findUnique({
      where: { id: scopeId },
    });

    if (!existing) {
      throw new AppError(404, 'GOV_SCOPE_NOT_FOUND', 'Government scope not found');
    }

    const updated = await prisma.govAuditorScope.update({
      where: { id: scopeId },
      data: {
        notes: input.notes === null ? null : input.notes ?? undefined,
        startsAt:
          input.startsAt === null
            ? null
            : input.startsAt
              ? new Date(input.startsAt)
              : undefined,
        endsAt:
          input.endsAt === null
            ? null
            : input.endsAt
              ? new Date(input.endsAt)
              : undefined,
        isActive: input.isActive,
      },
    });

    if (input.isActive === true) {
      await prisma.govAuditorScope.updateMany({
        where: {
          auditorUserId: updated.auditorUserId,
          isActive: true,
          id: { not: updated.id },
        },
        data: {
          isActive: false,
        },
      });
    }

    await this.syncAuditorProfileFromActiveScopes(prisma, updated.auditorUserId);

    await this.auditService.log({
      tenantId: platformTenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.GOV_AUDITOR_SCOPE_UPDATED,
      module: 'User',
      entity: 'GovAuditorScope',
      entityId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        updatedFields: Object.keys(input),
        isActive: updated.isActive,
      },
    });

    return this.mapScope(updated);
  }

  async createAudit(
    input: CreateGovAuditInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const access = await this.resolvePlatformAccess(actor);
    const school = await this.getScopedSchoolByIdOrThrow(access, input.schoolId);
    const auditorProfile = access.isSuperAdmin
      ? await this.resolveAuditAssigneeProfile(access.platformTenantId, school, input.auditorUserId)
      : await this.ensureAuditorProfileForUser(actor.sub);

    const created = await prisma.audit.create({
      data: {
        auditorId: auditorProfile.id,
        tenantId: school.tenantId,
        schoolId: school.id,
        createdByUserId: actor.sub,
        auditType: input.auditType,
        plannedDate: new Date(input.plannedDate),
        planNotes: input.planNotes?.trim() || null,
      },
      include: this.buildAuditInclude(),
    });

    await this.auditService.log({
      tenantId: school.tenantId,
      actorUserId: actor.sub,
      event: 'GOV_AUDIT_PLANNED',
      actionType: 'CREATE',
      module: 'Audit',
      entity: 'Audit',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        schoolId: school.id,
        schoolName: school.displayName,
        auditorUserId: auditorProfile.userId,
        auditType: created.auditType,
        plannedDate: created.plannedDate.toISOString(),
      },
    });

    return this.mapAudit(created);
  }

  async listAudits(actor: JwtUser, query: ListGovAuditsQueryInput) {
    const access = await this.resolvePlatformAccess(actor);

    if (!access.schoolWhere) {
      return {
        items: [],
        pagination: buildPagination(query.page, query.pageSize, 0),
      };
    }

    const where: Prisma.AuditWhereInput = access.isSuperAdmin
      ? {}
      : {
          school: access.schoolWhere,
        };

    if (query.status) {
      where.status = query.status;
    }

    if (query.auditType) {
      where.auditType = query.auditType;
    }

    if (query.schoolId) {
      where.schoolId = query.schoolId;
    }

    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, audits] = await prisma.$transaction([
      prisma.audit.count({ where }),
      prisma.audit.findMany({
        where,
        skip,
        take: query.pageSize,
        include: this.buildAuditInclude(),
        orderBy: [{ plannedDate: 'desc' }, { createdAt: 'desc' }],
      }),
    ]);

    return {
      items: audits.map((audit) => this.mapAudit(audit)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async getAuditDetail(actor: JwtUser, auditId: string) {
    const access = await this.resolvePlatformAccess(actor);
    const audit = await this.getScopedAuditOrThrow(access, auditId);

    return this.mapAudit(audit);
  }

  async submitReport(
    actor: JwtUser,
    input: SubmitGovAuditReportInput,
    context: RequestAuditContext,
  ) {
    const access = await this.resolvePlatformAccess(actor);
    const audit = await this.getScopedAuditOrThrow(access, input.auditId);

    if (audit.report) {
      throw new AppError(409, 'AUDIT_REPORT_EXISTS', 'This audit already has a report');
    }

    if (!access.isSuperAdmin && audit.auditor.user.id !== actor.sub) {
      throw new AppError(403, 'GOV_AUDIT_FORBIDDEN', 'You can only submit reports for your own audits');
    }

    const score = this.calculateAuditScore(input);

    const completedAudit = await prisma.$transaction(async (tx) => {
      await tx.audit.update({
        where: { id: audit.id },
        data: {
          status: AuditStatus.COMPLETED,
          completedAt: new Date(),
        },
      });

      await tx.auditReport.create({
        data: {
          auditId: audit.id,
          submittedByUserId: actor.sub,
          teachingQuality: input.teachingQuality,
          infrastructure: input.infrastructure,
          discipline: input.discipline,
          comment: input.comment.trim(),
          findings: input.findings.trim(),
          recommendations: input.recommendations.trim(),
          score,
        },
      });

      return tx.audit.findUniqueOrThrow({
        where: { id: audit.id },
        include: this.buildAuditInclude(),
      });
    });

    await this.auditService.log({
      tenantId: audit.tenantId,
      actorUserId: actor.sub,
      event: 'GOV_AUDIT_REPORT_SUBMITTED',
      actionType: 'CREATE',
      module: 'Audit',
      entity: 'AuditReport',
      entityId: completedAudit.report?.id ?? audit.id,
      recordId: audit.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        auditId: audit.id,
        score,
      },
    });

    return this.mapAudit(completedAudit);
  }

  async listReports(actor: JwtUser, query: ListGovReportsQueryInput) {
    const access = await this.resolvePlatformAccess(actor);

    if (!access.schoolWhere) {
      return {
        items: [],
        pagination: buildPagination(query.page, query.pageSize, 0),
      };
    }

    const where: Prisma.AuditWhereInput = {
      status: AuditStatus.COMPLETED,
      ...(access.isSuperAdmin
        ? {}
        : {
            school: access.schoolWhere,
          }),
    };

    if (query.auditType) {
      where.auditType = query.auditType;
    }

    if (query.schoolId) {
      where.schoolId = query.schoolId;
    }

    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, audits] = await prisma.$transaction([
      prisma.audit.count({ where }),
      prisma.audit.findMany({
        where,
        skip,
        take: query.pageSize,
        include: this.buildAuditInclude(),
        orderBy: [{ completedAt: 'desc' }, { plannedDate: 'desc' }],
      }),
    ]);

    return {
      items: audits.map((audit) => this.mapAuditReport(audit)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async listActivityLogs(actor: JwtUser, query: ListGovActivityLogsQueryInput) {
    const access = await this.resolvePlatformAccess(actor);

    if (!access.isSuperAdmin && !access.schoolWhere) {
      return {
        items: [],
        pagination: buildPagination(query.page, query.pageSize, 0),
      };
    }

    const filters: Prisma.AuditLogWhereInput[] = [
      {
        OR: [
          { module: { in: ['Audit', 'School', 'User'] } },
          { event: { startsWith: 'GOV_' } },
        ],
      },
    ];

    if (!access.isSuperAdmin && access.schoolWhere) {
      filters.push({
        tenant: {
          school: access.schoolWhere,
        },
      });
    }

    if (query.actionType) {
      filters.push({
        actionType: query.actionType,
      });
    }

    if (query.module) {
      filters.push({
        module: {
          equals: query.module,
          mode: 'insensitive',
        },
      });
    }

    if (query.search) {
      filters.push({
        OR: [
          { event: { contains: query.search, mode: 'insensitive' } },
          { module: { contains: query.search, mode: 'insensitive' } },
          { description: { contains: query.search, mode: 'insensitive' } },
          { actorName: { contains: query.search, mode: 'insensitive' } },
          { schoolName: { contains: query.search, mode: 'insensitive' } },
          { recordId: { contains: query.search, mode: 'insensitive' } },
        ],
      });
    }

    const where: Prisma.AuditLogWhereInput =
      filters.length === 1 ? filters[0] : { AND: filters };
    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, logs] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        skip,
        take: query.pageSize,
        orderBy: { createdAt: 'desc' },
        include: {
          actorUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
          tenant: {
            select: {
              id: true,
              code: true,
              name: true,
              school: {
                select: {
                  displayName: true,
                },
              },
            },
          },
        },
      }),
    ]);

    return {
      items: logs.map((row) => {
        const actorName =
          row.actorName ??
          (`${row.actorUser?.firstName ?? ''} ${row.actorUser?.lastName ?? ''}`.trim() || null);

        return {
          id: String(row.id),
          event: row.event,
          actionType: row.actionType,
          module: row.module,
          description: row.description,
          entity: row.entity,
          entityId: row.entityId,
          recordId: row.recordId ?? row.entityId,
          createdAt: row.createdAt.toISOString(),
          timestamp: row.createdAt.toISOString(),
          ipAddress: row.ipAddress,
          device: row.device ?? row.userAgent,
          status: row.status,
          sessionId: row.sessionId,
          actor: row.actorUserId || actorName || row.actorRole
            ? {
                id: row.actorUser?.id ?? row.actorUserId ?? null,
                email: row.actorUser?.email ?? null,
                name: actorName,
                role: row.actorRole,
              }
            : null,
          schoolName: row.schoolName ?? row.tenant.school?.displayName ?? row.tenant.name,
          tenant: {
            id: row.tenant.id,
            code: row.tenant.code,
            name: row.tenant.name,
          },
          oldValue: row.oldValue,
          newValue: row.newValue,
          payload: row.payload,
        };
      }),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async getDashboard(actor: JwtUser) {
    const access = await this.resolvePlatformAccess(actor);

    if (!access.schoolWhere) {
      return {
        audits: {
          totalSchools: 0,
          plannedAudits: 0,
          completedAudits: 0,
          averageScore: 0,
          recentAudits: [] as Array<{
            id: string;
            schoolName: string;
            auditType: string;
            plannedDate: string;
            status: string;
            score: number | null;
          }>,
          upcomingAudits: [] as Array<{
            id: string;
            schoolName: string;
            auditType: string;
            plannedDate: string;
            status: string;
          }>,
        },
        scope: {
          schoolsInScope: 0,
          activeAssignments: 0,
        },
        incidents: {
          total: 0,
          open: 0,
          resolved: 0,
          last30Days: 0,
        },
        feedback: {
          authoredByMe: 0,
          recentDiscussion: [] as Array<{
            id: string;
            body: string;
            createdAt: string;
            authorName: string;
            incidentId: string;
            incidentTitle: string;
            schoolName: string | null;
          }>,
        },
        myScopes: [] as Array<{
          id: string;
          label: string;
          scopeLevel: GovScopeLevel;
          assignedBy: { firstName: string; lastName: string; email: string } | null;
        }>,
      };
    }

    const schoolRelationFilter = access.isSuperAdmin
      ? undefined
      : {
          school: access.schoolWhere,
        };

    const since30 = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);

    const scopedTenantFilter = schoolRelationFilter
      ? { tenant: schoolRelationFilter }
      : undefined;
    const scopedAuditWhere = access.isSuperAdmin
      ? {}
      : {
          school: access.schoolWhere,
        };
    const scopedReportWhere = access.isSuperAdmin
      ? {}
      : {
          audit: {
            school: access.schoolWhere,
          },
        };

    const [
      schoolsInScope,
      activeAssignments,
      totalIncidents,
      openIncidents,
      resolvedIncidents,
      incidentsLast30Days,
      authoredByMe,
      plannedAudits,
      completedAudits,
      averageScore,
    ] = await prisma.$transaction([
      prisma.school.count({
        where: access.schoolWhere,
      }),
      access.isSuperAdmin
        ? prisma.govAuditorScope.count({
            where: { isActive: true },
          })
        : prisma.govAuditorScope.count({
            where: this.activeScopeWhere(actor.sub),
          }),
      prisma.conductIncident.count({
        where: scopedTenantFilter ?? {},
      }),
      prisma.conductIncident.count({
        where: {
          ...(scopedTenantFilter ?? {}),
          status: { not: 'RESOLVED' },
        },
      }),
      prisma.conductIncident.count({
        where: {
          ...(scopedTenantFilter ?? {}),
          status: 'RESOLVED',
        },
      }),
      prisma.conductIncident.count({
        where: {
          ...(scopedTenantFilter ?? {}),
          occurredAt: { gte: since30 },
        },
      }),
      prisma.conductFeedback.count({
        where: {
          authorUserId: actor.sub,
          authorType: ConductFeedbackAuthorType.GOV_AUDITOR,
        },
      }),
      prisma.audit.count({
        where: {
          ...scopedAuditWhere,
          status: {
            in: [AuditStatus.PLANNED, AuditStatus.IN_PROGRESS],
          },
        },
      }),
      prisma.audit.count({
        where: {
          ...scopedAuditWhere,
          status: AuditStatus.COMPLETED,
        },
      }),
      prisma.auditReport.aggregate({
        where: scopedReportWhere,
        _avg: {
          score: true,
        },
      }),
    ]);

    const recentRows = await prisma.conductFeedback.findMany({
      where: {
        authorType: ConductFeedbackAuthorType.GOV_AUDITOR,
        ...(scopedTenantFilter
          ? {
              incident: scopedTenantFilter,
            }
          : {}),
      },
      take: 6,
      orderBy: { createdAt: 'desc' },
      include: {
        authorUser: { select: { firstName: true, lastName: true } },
        incident: {
          select: {
            id: true,
            title: true,
            tenant: {
              select: { school: { select: { displayName: true } } },
            },
          },
        },
      },
    });

    const [recentAuditRows, upcomingAuditRows] = await prisma.$transaction([
      prisma.audit.findMany({
        where: {
          ...scopedAuditWhere,
          status: AuditStatus.COMPLETED,
        },
        take: 5,
        orderBy: [{ completedAt: 'desc' }, { plannedDate: 'desc' }],
        include: this.buildAuditInclude(),
      }),
      prisma.audit.findMany({
        where: {
          ...scopedAuditWhere,
          status: {
            in: [AuditStatus.PLANNED, AuditStatus.IN_PROGRESS],
          },
          plannedDate: {
            gte: startOfToday,
          },
        },
        take: 5,
        orderBy: [{ plannedDate: 'asc' }, { createdAt: 'desc' }],
        include: this.buildAuditInclude(),
      }),
    ]);

    let myScopes: Array<{
      id: string;
      label: string;
      scopeLevel: GovScopeLevel;
      assignedBy: { firstName: string; lastName: string; email: string } | null;
    }> = [];

    if (!access.isSuperAdmin) {
      const scopeRows = await prisma.govAuditorScope.findMany({
        where: this.activeScopeWhere(actor.sub),
        include: {
          assignedByUser: { select: { firstName: true, lastName: true, email: true } },
        },
        orderBy: { createdAt: 'desc' },
      });
      myScopes = scopeRows.map((s) => ({
        id: s.id,
        label: this.formatScopeLabel(s),
        scopeLevel: s.scopeLevel,
        assignedBy: s.assignedByUser
          ? {
              firstName: s.assignedByUser.firstName,
              lastName: s.assignedByUser.lastName,
              email: s.assignedByUser.email,
            }
          : null,
      }));
    }

    return {
      audits: {
        totalSchools: schoolsInScope,
        plannedAudits,
        completedAudits,
        averageScore: Number((averageScore._avg.score ?? 0).toFixed(1)),
        recentAudits: recentAuditRows.map((audit) => ({
          id: audit.id,
          schoolName: audit.school.displayName,
          auditType: audit.auditType,
          plannedDate: audit.plannedDate.toISOString(),
          status: audit.status,
          score: audit.report?.score ?? null,
        })),
        upcomingAudits: upcomingAuditRows.map((audit) => ({
          id: audit.id,
          schoolName: audit.school.displayName,
          auditType: audit.auditType,
          plannedDate: audit.plannedDate.toISOString(),
          status: audit.status,
        })),
      },
      scope: {
        schoolsInScope,
        activeAssignments,
      },
      incidents: {
        total: totalIncidents,
        open: openIncidents,
        resolved: resolvedIncidents,
        last30Days: incidentsLast30Days,
      },
      feedback: {
        authoredByMe,
        recentDiscussion: recentRows.map((row) => ({
          id: row.id,
          body: row.body.length > 220 ? `${row.body.slice(0, 217)}…` : row.body,
          createdAt: row.createdAt.toISOString(),
          authorName: `${row.authorUser.firstName} ${row.authorUser.lastName}`.trim(),
          incidentId: row.incident.id,
          incidentTitle: row.incident.title,
          schoolName: row.incident.tenant.school?.displayName ?? null,
        })),
      },
      myScopes,
    };
  }

  async listMyScopes(actor: JwtUser) {
    await this.assertPlatformActor(actor);
    if (actor.roles.includes('SUPER_ADMIN')) {
      return { items: [] };
    }

    const scopes = await prisma.govAuditorScope.findMany({
      where: this.activeScopeWhere(actor.sub),
      include: {
        assignedByUser: { select: { firstName: true, lastName: true, email: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    return {
      items: scopes.map((scope) => this.mapScope(scope)),
    };
  }

  async listSchoolCourses(actor: JwtUser, tenantId: string) {
    const access = await this.resolvePlatformAccess(actor);
    await this.getScopedSchoolOrThrow(access, tenantId);

    const courses = await prisma.course.findMany({
      where: { tenantId, isActive: true },
      take: 200,
      orderBy: [{ updatedAt: 'desc' }],
      include: {
        academicYear: { select: { id: true, name: true } },
        classRoom: { select: { id: true, code: true, name: true } },
        subject: { select: { id: true, code: true, name: true } },
        teacherUser: { select: { id: true, firstName: true, lastName: true } },
      },
    });

    return {
      items: courses.map((c) => ({
        id: c.id,
        title: c.title,
        description: c.description,
        isActive: c.isActive,
        updatedAt: c.updatedAt.toISOString(),
        academicYear: c.academicYear,
        classRoom: c.classRoom,
        subject: c.subject,
        teacher: {
          id: c.teacherUser.id,
          firstName: c.teacherUser.firstName,
          lastName: c.teacherUser.lastName,
        },
      })),
    };
  }

  async getSchoolConductReportSummary(actor: JwtUser, tenantId: string, query: ConductSchoolReportQueryInput) {
    const access = await this.resolvePlatformAccess(actor);
    await this.getScopedSchoolOrThrow(access, tenantId);
    return this.reportsOps.conductSchoolSummary(tenantId, query, actor);
  }

  async listSchools(actor: JwtUser, query: ListGovSchoolsQueryInput) {
    const access = await this.resolvePlatformAccess(actor);

    if (!access.schoolWhere) {
      return {
        items: [],
        pagination: buildPagination(query.page, query.pageSize, 0),
      };
    }

    const where = this.combineSchoolWhere(access.schoolWhere, {
      province: query.province,
      district: query.district,
      sector: query.sector,
      q: query.q,
    });
    const skip = (query.page - 1) * query.pageSize;

    let auditorScopeRows: Array<{
      scopeLevel: GovScopeLevel;
      country: string;
      province: string | null;
      district: string | null;
      sector: string | null;
    }> = [];
    if (!access.isSuperAdmin) {
      auditorScopeRows = await prisma.govAuditorScope.findMany({
        where: this.activeScopeWhere(actor.sub),
        select: {
          scopeLevel: true,
          country: true,
          province: true,
          district: true,
          sector: true,
        },
        orderBy: { createdAt: 'desc' },
      });
    }

    const [totalItems, schools] = await prisma.$transaction([
      prisma.school.count({ where }),
      prisma.school.findMany({
        where,
        skip,
        take: query.pageSize,
        include: {
          tenant: {
            select: {
              id: true,
              code: true,
              name: true,
              isActive: true,
            },
          },
        },
        orderBy: [{ district: 'asc' }, { sector: 'asc' }, { displayName: 'asc' }],
      }),
    ]);

    return {
      items: schools.map((school) => ({
        id: school.id,
        tenantId: school.tenantId,
        code: school.tenant.code,
        displayName: school.displayName,
        district: school.district,
        sector: school.sector,
        province: school.province,
        country: school.country,
        setupCompletedAt: school.setupCompletedAt,
        isActive: school.tenant.isActive,
        scopeLabel: access.isSuperAdmin
          ? null
          : this.scopeLabelForSchool(
              {
                country: school.country,
                province: school.province,
                district: school.district,
                sector: school.sector,
              },
              auditorScopeRows,
            ),
      })),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async getSchoolDetail(actor: JwtUser, tenantId: string) {
    const access = await this.resolvePlatformAccess(actor);
    const school = await this.getScopedSchoolOrThrow(access, tenantId);

    const [totalIncidents, openIncidents, resolvedIncidents, recentIncidents] =
      await prisma.$transaction([
        prisma.conductIncident.count({
          where: { tenantId },
        }),
        prisma.conductIncident.count({
          where: {
            tenantId,
            status: { not: 'RESOLVED' },
          },
        }),
        prisma.conductIncident.count({
          where: {
            tenantId,
            status: 'RESOLVED',
          },
        }),
        prisma.conductIncident.findMany({
          where: { tenantId },
          take: 5,
          include: conductIncidentInclude,
          orderBy: [{ occurredAt: 'desc' }, { createdAt: 'desc' }],
        }),
      ]);

    return {
      school: {
        id: school.id,
        tenantId: school.tenantId,
        code: school.tenant.code,
        displayName: school.displayName,
        district: school.district,
        sector: school.sector,
        province: school.province,
        country: school.country,
        setupCompletedAt: school.setupCompletedAt,
      },
      summary: {
        totalIncidents,
        openIncidents,
        resolvedIncidents,
      },
      recentIncidents: recentIncidents.map((incident) =>
        mapConductIncident(incident, 'gov'),
      ),
    };
  }

  async listIncidents(actor: JwtUser, query: ListGovIncidentsQueryInput) {
    const access = await this.resolvePlatformAccess(actor);

    if (!access.schoolWhere) {
      return {
        items: [],
        pagination: buildPagination(query.page, query.pageSize, 0),
      };
    }

    const where = this.buildIncidentWhere(access, query);
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
      items: incidents.map((incident) => mapConductIncident(incident, 'gov')),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async getIncidentDetail(actor: JwtUser, incidentId: string) {
    const access = await this.resolvePlatformAccess(actor);
    const incident = await this.getScopedIncidentOrThrow(access, {
      id: incidentId,
    });

    return mapConductIncident(incident, 'gov');
  }

  async addFeedback(
    actor: JwtUser,
    incidentId: string,
    input: AddGovFeedbackInput,
    context: RequestAuditContext,
  ) {
    const access = await this.resolvePlatformAccess(actor);
    const incident = await this.getScopedIncidentOrThrow(access, {
      id: incidentId,
    });

    await prisma.conductFeedback.create({
      data: {
        tenantId: incident.tenantId,
        incidentId: incident.id,
        authorUserId: actor.sub,
        authorType: ConductFeedbackAuthorType.GOV_AUDITOR,
        body: input.body,
      },
    });

    await this.auditService.log({
      tenantId: incident.tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_FEEDBACK_ADDED,
      entity: 'ConductIncident',
      entityId: incident.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        authorType: ConductFeedbackAuthorType.GOV_AUDITOR,
      },
    });

    return this.getIncidentDetail(actor, incidentId);
  }

  private async resolvePlatformAccess(actor: JwtUser): Promise<PlatformContext> {
    const platformTenantId = await this.assertPlatformActor(actor);
    const isSuperAdmin = actor.roles.includes('SUPER_ADMIN');

    if (isSuperAdmin) {
      return {
        platformTenantId,
        schoolWhere: {},
        isSuperAdmin: true,
      };
    }

    const scopes = await prisma.govAuditorScope.findMany({
      where: this.activeScopeWhere(actor.sub),
      orderBy: { createdAt: 'desc' },
    });

    return {
      platformTenantId,
      schoolWhere: scopes.length
        ? {
            OR: scopes.map((scope) => this.scopeToSchoolWhere(scope)),
          }
        : null,
      isSuperAdmin: false,
    };
  }

  private async assertPlatformActor(actor: JwtUser) {
    this.assertGovRuntimeReady();

    const platformTenant = await prisma.tenant.findUnique({
      where: { code: 'platform' },
      select: { id: true },
    });

    if (!platformTenant) {
      throw new AppError(500, 'PLATFORM_TENANT_MISSING', 'Platform tenant is not configured');
    }

    if (actor.tenantId !== platformTenant.id) {
      throw new AppError(
        403,
        'GOV_PLATFORM_ACCESS_REQUIRED',
        'Government access requires platform tenant credentials',
      );
    }

    return platformTenant.id;
  }

  private assertGovRuntimeReady() {
    const runtimePrisma = prisma as unknown as Record<string, unknown>;

    if (
      !runtimePrisma.govAuditorScope ||
      !runtimePrisma.auditor ||
      !runtimePrisma.audit ||
      !runtimePrisma.auditReport ||
      !runtimePrisma.conductIncident ||
      !runtimePrisma.conductFeedback
    ) {
      throw new AppError(
        503,
        'GOV_RUNTIME_RESTART_REQUIRED',
        'Government auditing is running with an outdated Prisma client. Restart the backend after prisma generate.',
      );
    }
  }

  private async ensureGovAuditorRole(platformTenantId: string) {
    return prisma.role.upsert({
      where: {
        tenantId_name: {
          tenantId: platformTenantId,
          name: 'GOV_AUDITOR',
        },
      },
      update: {
        permissions: GOV_AUDITOR_PERMISSIONS,
      },
      create: {
        tenantId: platformTenantId,
        name: 'GOV_AUDITOR',
        description: 'Government auditor role',
        isSystem: true,
        permissions: GOV_AUDITOR_PERMISSIONS,
      },
    });
  }

  private async ensureAuditorUser(platformTenantId: string, auditorUserId: string) {
    const auditor = await prisma.user.findFirst({
      where: {
        id: auditorUserId,
        tenantId: platformTenantId,
        deletedAt: null,
        userRoles: {
          some: {
            role: {
              name: 'GOV_AUDITOR',
            },
          },
        },
      },
      select: { id: true },
    });

    if (!auditor) {
      throw new AppError(404, 'GOV_AUDITOR_NOT_FOUND', 'Government auditor not found');
    }
  }

  private buildIncidentWhere(
    access: PlatformContext,
    query: ListGovIncidentsQueryInput,
  ): Prisma.ConductIncidentWhereInput {
    const where: Prisma.ConductIncidentWhereInput = {};

    if (!access.isSuperAdmin && access.schoolWhere) {
      where.tenant = {
        school: access.schoolWhere,
      };
    }

    if (query.tenantId) {
      where.tenantId = query.tenantId;
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
        {
          tenant: {
            school: {
              displayName: {
                contains: query.q,
                mode: 'insensitive',
              },
            },
          },
        },
      ];
    }

    return where;
  }

  private async getScopedSchoolOrThrow(access: PlatformContext, tenantId: string) {
    if (!access.schoolWhere) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'School is outside the assigned scope');
    }

    const school = await prisma.school.findFirst({
      where: access.isSuperAdmin
        ? { tenantId }
        : {
            AND: [access.schoolWhere, { tenantId }],
          },
      include: {
        tenant: {
          select: {
            id: true,
            code: true,
            name: true,
          },
        },
      },
    });

    if (!school) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'School is outside the assigned scope');
    }

    return school;
  }

  private async getScopedSchoolByIdOrThrow(access: PlatformContext, schoolId: string) {
    if (!access.isSuperAdmin && !access.schoolWhere) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'School is outside the assigned scope');
    }

    const school = await prisma.school.findFirst({
      where: access.isSuperAdmin
        ? { id: schoolId }
        : {
            AND: [access.schoolWhere!, { id: schoolId }],
          },
      include: {
        tenant: {
          select: {
            id: true,
            code: true,
            name: true,
            isActive: true,
          },
        },
      },
    });

    if (!school) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'School is outside the assigned scope');
    }

    return school;
  }

  private async getScopedAuditOrThrow(access: PlatformContext, auditId: string) {
    if (!access.isSuperAdmin && !access.schoolWhere) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'Audit is outside the assigned scope');
    }

    const audit = await prisma.audit.findFirst({
      where: access.isSuperAdmin
        ? { id: auditId }
        : {
            AND: [
              { id: auditId },
              {
                school: access.schoolWhere!,
              },
            ],
          },
      include: this.buildAuditInclude(),
    });

    if (!audit) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'Audit is outside the assigned scope');
    }

    return audit;
  }

  private async getScopedIncidentOrThrow(
    access: PlatformContext,
    where: Prisma.ConductIncidentWhereInput,
  ) {
    if (!access.schoolWhere) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'Incident is outside the assigned scope');
    }

    const incident = await prisma.conductIncident.findFirst({
      where: access.isSuperAdmin
        ? where
        : {
            AND: [
              where,
              {
                tenant: {
                  school: access.schoolWhere,
                },
              },
            ],
          },
      include: conductIncidentInclude,
    });

    if (!incident) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'Incident is outside the assigned scope');
    }

    return incident;
  }

  private async ensureAuditorProfileForUser(
    userId: string,
    executor: PrismaExecutor = prisma,
    defaultIsActive = false,
  ) {
    const existing = await executor.auditor.findUnique({
      where: { userId },
    });

    if (existing) {
      return existing;
    }

    const latestScope = await executor.govAuditorScope.findFirst({
      where: this.activeScopeWhere(userId),
      orderBy: { createdAt: 'desc' },
    });

    const profileData = latestScope
      ? this.scopeToAuditorProfileData(latestScope)
      : {
          level: AuditorLevel.NATIONAL,
          country: 'Rwanda',
          province: null,
          district: null,
          sector: null,
          isActive: defaultIsActive,
        };

    return executor.auditor.create({
      data: {
        userId,
        level: profileData.level,
        country: profileData.country,
        province: profileData.province,
        district: profileData.district,
        sector: profileData.sector,
        isActive: profileData.isActive,
      },
    });
  }

  private async resolveAuditAssigneeProfile(
    platformTenantId: string,
    school: {
      country: string | null;
      province: string | null;
      district: string | null;
      sector: string | null;
    },
    auditorUserId?: string,
  ) {
    if (!auditorUserId) {
      throw new AppError(
        400,
        'GOV_AUDITOR_REQUIRED',
        'Super admins must assign an auditor before planning an audit',
      );
    }

    const selectedAuditor = await prisma.user.findFirst({
      where: {
        id: auditorUserId,
        tenantId: platformTenantId,
        deletedAt: null,
        status: 'ACTIVE',
        userRoles: {
          some: {
            role: {
              name: 'GOV_AUDITOR',
            },
          },
        },
      },
      select: { id: true },
    });

    if (!selectedAuditor) {
      throw new AppError(404, 'GOV_AUDITOR_NOT_FOUND', 'Selected auditor was not found or is inactive');
    }

    const scopes = await prisma.govAuditorScope.findMany({
      where: this.activeScopeWhere(auditorUserId),
      orderBy: { createdAt: 'desc' },
    });

    if (!scopes.length) {
      throw new AppError(
        400,
        'GOV_AUDITOR_SCOPE_REQUIRED',
        'Selected auditor must have an active assignment before you can plan an audit',
      );
    }

    const coversSchool = scopes.some((scope) =>
      this.schoolMatchesScope(
        {
          country: school.country,
          province: school.province,
          district: school.district,
          sector: school.sector,
        },
        scope,
      ),
    );

    if (!coversSchool) {
      throw new AppError(
        400,
        'GOV_AUDITOR_SCOPE_MISMATCH',
        'Selected auditor is not assigned to the chosen school location',
      );
    }

    return this.ensureAuditorProfileForUser(auditorUserId);
  }

  private async syncAuditorProfileFromScope(
    executor: PrismaExecutor,
    auditorUserId: string,
    scope: {
      scopeLevel: GovScopeLevel;
      country: string;
      province: string | null;
      district: string | null;
      sector: string | null;
      isActive: boolean;
    },
  ) {
    const profile = this.scopeToAuditorProfileData(scope);

    await executor.auditor.upsert({
      where: { userId: auditorUserId },
      update: {
        level: profile.level,
        country: profile.country,
        province: profile.province,
        district: profile.district,
        sector: profile.sector,
        isActive: scope.isActive,
      },
      create: {
        userId: auditorUserId,
        level: profile.level,
        country: profile.country,
        province: profile.province,
        district: profile.district,
        sector: profile.sector,
        isActive: scope.isActive,
      },
    });
  }

  private async syncAuditorProfileFromActiveScopes(
    executor: PrismaExecutor,
    auditorUserId: string,
  ) {
    const latestScope = await executor.govAuditorScope.findFirst({
      where: this.activeScopeWhere(auditorUserId),
      orderBy: { createdAt: 'desc' },
    });

    if (!latestScope) {
      await executor.auditor.updateMany({
        where: { userId: auditorUserId },
        data: { isActive: false },
      });
      return;
    }

    await this.syncAuditorProfileFromScope(executor, auditorUserId, latestScope);
  }

  private combineSchoolWhere(
    baseWhere: Prisma.SchoolWhereInput,
    filters: {
      province?: string;
      district?: string;
      sector?: string;
      q?: string;
    },
  ): Prisma.SchoolWhereInput {
    const extra: Prisma.SchoolWhereInput = {};

    if (filters.province) {
      extra.province = filters.province;
    }

    if (filters.district) {
      extra.district = filters.district;
    }

    if (filters.sector) {
      extra.sector = filters.sector;
    }

    if (filters.q) {
      extra.OR = [
        {
          displayName: {
            contains: filters.q,
            mode: 'insensitive',
          },
        },
        {
          tenant: {
            code: {
              contains: filters.q,
              mode: 'insensitive',
            },
          },
        },
        {
          district: {
            contains: filters.q,
            mode: 'insensitive',
          },
        },
        {
          sector: {
            contains: filters.q,
            mode: 'insensitive',
          },
        },
      ];
    }

    return Object.keys(baseWhere).length
      ? { AND: [baseWhere, extra] }
      : extra;
  }

  private normalizeScope(input: AssignGovAuditorScopeInput) {
    return {
      scopeLevel: input.scopeLevel,
      country: input.country,
      province:
        input.scopeLevel === GovScopeLevel.PROVINCE ||
        input.scopeLevel === GovScopeLevel.DISTRICT ||
        input.scopeLevel === GovScopeLevel.SECTOR
          ? input.province ?? null
          : null,
      district:
        input.scopeLevel === GovScopeLevel.DISTRICT ||
        input.scopeLevel === GovScopeLevel.SECTOR
          ? input.district ?? null
          : null,
      sector:
        input.scopeLevel === GovScopeLevel.SECTOR ? input.sector ?? null : null,
      notes: input.notes ?? null,
      startsAt: input.startsAt ? new Date(input.startsAt) : null,
      endsAt: input.endsAt ? new Date(input.endsAt) : null,
    };
  }

  private normalizeAuditorProfileInput(input: {
    level: AuditorLevel;
    country: string;
    province?: string;
    district?: string;
    sector?: string;
  }) {
    return {
      level: input.level,
      country: input.country,
      province:
        input.level === AuditorLevel.PROVINCE ||
        input.level === AuditorLevel.DISTRICT ||
        input.level === AuditorLevel.SECTOR
          ? input.province ?? null
          : null,
      district:
        input.level === AuditorLevel.DISTRICT ||
        input.level === AuditorLevel.SECTOR
          ? input.district ?? null
          : null,
      sector:
        input.level === AuditorLevel.SECTOR ? input.sector ?? null : null,
    };
  }

  private auditorProfileToScope(input: {
    level: AuditorLevel;
    country: string;
    province: string | null;
    district: string | null;
    sector: string | null;
  }) {
    return {
      scopeLevel:
        input.level === AuditorLevel.NATIONAL
          ? GovScopeLevel.COUNTRY
          : input.level === AuditorLevel.PROVINCE
            ? GovScopeLevel.PROVINCE
            : input.level === AuditorLevel.DISTRICT
              ? GovScopeLevel.DISTRICT
              : GovScopeLevel.SECTOR,
      country: input.country,
      province: input.province,
      district: input.district,
      sector: input.sector,
    };
  }

  private scopeToAuditorProfileData(scope: {
    scopeLevel: GovScopeLevel;
    country: string;
    province: string | null;
    district: string | null;
    sector: string | null;
    isActive?: boolean;
  }) {
    return {
      level:
        scope.scopeLevel === GovScopeLevel.COUNTRY
          ? AuditorLevel.NATIONAL
          : scope.scopeLevel === GovScopeLevel.PROVINCE
            ? AuditorLevel.PROVINCE
            : scope.scopeLevel === GovScopeLevel.DISTRICT
              ? AuditorLevel.DISTRICT
              : AuditorLevel.SECTOR,
      country: scope.country,
      province: scope.province,
      district: scope.district,
      sector: scope.sector,
      isActive: scope.isActive ?? true,
    };
  }

  private buildAuditInclude() {
    return {
      school: {
        select: {
          id: true,
          tenantId: true,
          displayName: true,
          province: true,
          district: true,
          sector: true,
          country: true,
          tenant: {
            select: {
              id: true,
              code: true,
              name: true,
              isActive: true,
            },
          },
        },
      },
      auditor: {
        select: {
          id: true,
          level: true,
          country: true,
          province: true,
          district: true,
          sector: true,
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
      createdByUser: {
        select: {
          id: true,
          email: true,
          firstName: true,
          lastName: true,
        },
      },
      report: {
        select: {
          id: true,
          teachingQuality: true,
          infrastructure: true,
          discipline: true,
          comment: true,
          findings: true,
          recommendations: true,
          score: true,
          submittedAt: true,
          submittedByUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
      },
    } as const;
  }

  private calculateAuditScore(input: {
    teachingQuality: number;
    infrastructure: number;
    discipline: number;
  }) {
    return Math.round(((input.teachingQuality + input.infrastructure + input.discipline) / 15) * 100);
  }

  private scopeToSchoolWhere(scope: {
    scopeLevel: GovScopeLevel;
    country: string;
    province: string | null;
    district: string | null;
    sector: string | null;
  }): Prisma.SchoolWhereInput {
    if (scope.scopeLevel === GovScopeLevel.COUNTRY) {
      return {
        country: scope.country,
      };
    }

    if (scope.scopeLevel === GovScopeLevel.PROVINCE) {
      return {
        country: scope.country,
        province: scope.province,
      };
    }

    if (scope.scopeLevel === GovScopeLevel.DISTRICT) {
      return {
        country: scope.country,
        province: scope.province,
        district: scope.district,
      };
    }

    return {
      country: scope.country,
      province: scope.province,
      district: scope.district,
      sector: scope.sector,
    };
  }

  private activeScopeWhere(auditorUserId: string): Prisma.GovAuditorScopeWhereInput {
    const now = new Date();

    return {
      auditorUserId,
      isActive: true,
      AND: [
        {
          OR: [{ startsAt: null }, { startsAt: { lte: now } }],
        },
        {
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        },
      ],
    };
  }

  private formatScopeLabel(scope: {
    scopeLevel: GovScopeLevel;
    country: string;
    province: string | null;
    district: string | null;
    sector: string | null;
  }): string {
    const tail = [scope.province, scope.district, scope.sector].filter(Boolean).join(' › ');
    const level = scope.scopeLevel.replace(/_/g, ' ');
    return tail ? `${level} · ${scope.country} › ${tail}` : `${level} · ${scope.country}`;
  }

  private schoolMatchesScope(
    school: {
      country: string | null;
      province: string | null;
      district: string | null;
      sector: string | null;
    },
    scope: {
      scopeLevel: GovScopeLevel;
      country: string;
      province: string | null;
      district: string | null;
      sector: string | null;
    },
  ): boolean {
    if ((school.country ?? '') !== scope.country) {
      return false;
    }
    if (scope.scopeLevel === GovScopeLevel.COUNTRY) {
      return true;
    }
    if ((school.province ?? '') !== (scope.province ?? '')) {
      return false;
    }
    if (scope.scopeLevel === GovScopeLevel.PROVINCE) {
      return true;
    }
    if ((school.district ?? '') !== (scope.district ?? '')) {
      return false;
    }
    if (scope.scopeLevel === GovScopeLevel.DISTRICT) {
      return true;
    }
    return (school.sector ?? '') === (scope.sector ?? '');
  }

  private scopeLabelForSchool(
    school: {
      country: string | null;
      province: string | null;
      district: string | null;
      sector: string | null;
    },
    scopes: Array<{
      scopeLevel: GovScopeLevel;
      country: string;
      province: string | null;
      district: string | null;
      sector: string | null;
    }>,
  ): string | null {
    for (const scope of scopes) {
      if (this.schoolMatchesScope(school, scope)) {
        return this.formatScopeLabel(scope);
      }
    }
    return null;
  }

  private mapAuditor(auditor: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    status?: string;
    createdAt: Date;
    updatedAt: Date;
    auditorProfile?: {
      id: string;
      level: AuditorLevel;
      country: string;
      province: string | null;
      district: string | null;
      sector: string | null;
      isActive: boolean;
    } | null;
    govAuditorScopes: Array<{
      id: string;
      scopeLevel: GovScopeLevel;
      country: string;
      province: string | null;
      district: string | null;
      sector: string | null;
      notes: string | null;
      startsAt: Date | null;
      endsAt: Date | null;
      isActive: boolean;
      createdAt: Date;
      updatedAt: Date;
      assignedByUser?: {
        firstName: string;
        lastName: string;
        email: string;
      } | null;
    }>;
  }) {
    const activeScope =
      auditor.govAuditorScopes.find((scope) => scope.isActive) ??
      auditor.govAuditorScopes[0] ??
      null;
    const profile =
      auditor.auditorProfile ??
      (activeScope ? this.scopeToAuditorProfileData(activeScope) : null);

    return {
      id: auditor.id,
      email: auditor.email,
      firstName: auditor.firstName,
      lastName: auditor.lastName,
      phone: auditor.phone,
      status: auditor.status ?? 'ACTIVE',
      createdAt: auditor.createdAt,
      updatedAt: auditor.updatedAt,
      level: profile?.level ?? AuditorLevel.NATIONAL,
      country: profile?.country ?? 'Rwanda',
      province: profile?.province ?? null,
      district: profile?.district ?? null,
      sector: profile?.sector ?? null,
      assignmentLabel: this.buildAssignmentLabel({
        level: profile?.level ?? AuditorLevel.NATIONAL,
        country: profile?.country ?? 'Rwanda',
        province: profile?.province ?? null,
        district: profile?.district ?? null,
        sector: profile?.sector ?? null,
      }),
      scopes: auditor.govAuditorScopes.map((scope) => this.mapScope(scope)),
    };
  }

  private mapScope(scope: {
    id: string;
    scopeLevel: GovScopeLevel;
    country: string;
    province: string | null;
    district: string | null;
    sector: string | null;
    notes: string | null;
    startsAt: Date | null;
    endsAt: Date | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    assignedByUser?: {
      firstName: string;
      lastName: string;
      email: string;
    } | null;
  }) {
    return {
      id: scope.id,
      label: this.formatScopeLabel(scope),
      scopeLevel: scope.scopeLevel,
      country: scope.country,
      province: scope.province,
      district: scope.district,
      sector: scope.sector,
      notes: scope.notes,
      startsAt: scope.startsAt,
      endsAt: scope.endsAt,
      isActive: scope.isActive,
      createdAt: scope.createdAt,
      updatedAt: scope.updatedAt,
      assignedBy: scope.assignedByUser
        ? {
            firstName: scope.assignedByUser.firstName,
            lastName: scope.assignedByUser.lastName,
            email: scope.assignedByUser.email,
          }
        : null,
    };
  }

  private mapAudit(audit: {
    id: string;
    auditType: string;
    status: AuditStatus;
    plannedDate: Date;
    planNotes: string | null;
    completedAt: Date | null;
    createdAt: Date;
    updatedAt: Date;
    school: {
      id: string;
      tenantId: string;
      displayName: string;
      province: string | null;
      district: string | null;
      sector: string | null;
      country: string | null;
      tenant: {
        id: string;
        code: string;
        name: string;
        isActive: boolean;
      };
    };
    auditor: {
      id: string;
      level: AuditorLevel;
      country: string;
      province: string | null;
      district: string | null;
      sector: string | null;
      user: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
      };
    };
    createdByUser: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
    };
    report: {
      id: string;
      teachingQuality: number;
      infrastructure: number;
      discipline: number;
      comment: string;
      findings: string;
      recommendations: string;
      score: number;
      submittedAt: Date;
      submittedByUser: {
        id: string;
        email: string;
        firstName: string;
        lastName: string;
      };
    } | null;
  }) {
    return {
      id: audit.id,
      auditType: audit.auditType,
      status: audit.status,
      plannedDate: audit.plannedDate.toISOString(),
      planNotes: audit.planNotes,
      completedAt: audit.completedAt?.toISOString() ?? null,
      createdAt: audit.createdAt.toISOString(),
      updatedAt: audit.updatedAt.toISOString(),
      school: {
        id: audit.school.id,
        tenantId: audit.school.tenantId,
        code: audit.school.tenant.code,
        name: audit.school.displayName,
        province: audit.school.province,
        district: audit.school.district,
        sector: audit.school.sector,
        country: audit.school.country,
        isActive: audit.school.tenant.isActive,
      },
      auditor: {
        id: audit.auditor.id,
        userId: audit.auditor.user.id,
        email: audit.auditor.user.email,
        firstName: audit.auditor.user.firstName,
        lastName: audit.auditor.user.lastName,
        level: audit.auditor.level,
        country: audit.auditor.country,
        province: audit.auditor.province,
        district: audit.auditor.district,
        sector: audit.auditor.sector,
        assignmentLabel: this.buildAssignmentLabel({
          level: audit.auditor.level,
          country: audit.auditor.country,
          province: audit.auditor.province,
          district: audit.auditor.district,
          sector: audit.auditor.sector,
        }),
      },
      createdBy: {
        id: audit.createdByUser.id,
        email: audit.createdByUser.email,
        firstName: audit.createdByUser.firstName,
        lastName: audit.createdByUser.lastName,
      },
      report: audit.report
        ? {
            id: audit.report.id,
            teachingQuality: audit.report.teachingQuality,
            infrastructure: audit.report.infrastructure,
            discipline: audit.report.discipline,
            comment: audit.report.comment,
            findings: audit.report.findings,
            recommendations: audit.report.recommendations,
            score: audit.report.score,
            submittedAt: audit.report.submittedAt.toISOString(),
            submittedBy: {
              id: audit.report.submittedByUser.id,
              email: audit.report.submittedByUser.email,
              firstName: audit.report.submittedByUser.firstName,
              lastName: audit.report.submittedByUser.lastName,
            },
          }
        : null,
    };
  }

  private mapAuditReport(audit: Parameters<GovService['mapAudit']>[0]) {
    return this.mapAudit(audit);
  }

  private buildAssignmentLabel(input: {
    level: AuditorLevel;
    country: string;
    province: string | null;
    district: string | null;
    sector: string | null;
  }) {
    const levelLabel = input.level.replace(/_/g, ' ');

    if (input.level === AuditorLevel.NATIONAL) {
      return `${levelLabel} · ${input.country}`;
    }

    const parts =
      input.level === AuditorLevel.PROVINCE
        ? [input.province]
        : input.level === AuditorLevel.DISTRICT
          ? [input.province, input.district]
          : [input.province, input.district, input.sector];

    return `${levelLabel} · ${parts.filter(Boolean).join(' › ')}`;
  }
}

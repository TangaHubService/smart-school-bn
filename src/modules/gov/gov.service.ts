import {
  ConductFeedbackAuthorType,
  ConductSeverity,
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
import {
  conductIncidentInclude,
  mapConductIncident,
} from '../conduct/conduct.shared';
import {
  AddGovFeedbackInput,
  AssignGovAuditorScopeInput,
  CreateGovAuditorInput,
  ListGovAuditorsQueryInput,
  ListGovConductMarksQueryInput,
  ListGovIncidentsQueryInput,
  ListGovSchoolsQueryInput,
  UpdateGovAuditorScopeInput,
} from './gov.schemas';

type PlatformContext = {
  platformTenantId: string;
  schoolWhere: Prisma.SchoolWhereInput | null;
  isSuperAdmin: boolean;
};

const conductMarkInclude = {
  tenant: {
    select: {
      id: true,
      code: true,
      name: true,
      school: {
        select: {
          id: true,
          displayName: true,
          province: true,
          district: true,
          sector: true,
          country: true,
        },
      },
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
  feedback: {
    orderBy: { createdAt: 'asc' },
    include: {
      authorUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  },
} satisfies Prisma.ConductMarkInclude;

type ConductMarkRecord = Prisma.ConductMarkGetPayload<{
  include: typeof conductMarkInclude;
}>;

export class GovService {
  private readonly auditService = new AuditService();

  async createAuditor(
    input: CreateGovAuditorInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const platformTenantId = await this.assertPlatformActor(actor);
    const auditorRole = await this.ensureGovAuditorRole(platformTenantId);

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
        include: {
          govAuditorScopes: {
            orderBy: { createdAt: 'desc' },
          },
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

      return user;
    });

    await this.auditService.log({
      tenantId: platformTenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.GOV_AUDITOR_CREATED,
      entity: 'User',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        email: created.email,
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
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
    });

    return {
      items: auditors.map((auditor) => this.mapAuditor(auditor)),
    };
  }

  async listAuditorScopes(auditorUserId: string, actor: JwtUser) {
    const platformTenantId = await this.assertPlatformActor(actor);
    await this.ensureAuditorUser(platformTenantId, auditorUserId);

    const scopes = await prisma.govAuditorScope.findMany({
      where: {
        auditorUserId,
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

    const scope = await prisma.govAuditorScope.create({
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

    await this.auditService.log({
      tenantId: platformTenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.GOV_AUDITOR_SCOPE_ASSIGNED,
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

    await this.auditService.log({
      tenantId: platformTenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.GOV_AUDITOR_SCOPE_UPDATED,
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

  async getDashboard(actor: JwtUser) {
    const access = await this.resolvePlatformAccess(actor);

    if (!access.schoolWhere) {
      return {
        scope: {
          schoolsInScope: 0,
          activeAssignments: 0,
        },
        incidents: {
          total: 0,
          open: 0,
          resolved: 0,
        },
        feedback: {
          authoredByMe: 0,
        },
      };
    }

    const schoolRelationFilter = access.isSuperAdmin
      ? undefined
      : {
          school: access.schoolWhere,
        };

    const [schoolsInScope, activeAssignments, totalIncidents, openIncidents, resolvedIncidents, authoredByMe] =
      await prisma.$transaction([
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
          where: schoolRelationFilter ? { tenant: schoolRelationFilter } : {},
        }),
        prisma.conductIncident.count({
          where: {
            ...(schoolRelationFilter ? { tenant: schoolRelationFilter } : {}),
            status: { not: 'RESOLVED' },
          },
        }),
        prisma.conductIncident.count({
          where: {
            ...(schoolRelationFilter ? { tenant: schoolRelationFilter } : {}),
            status: 'RESOLVED',
          },
        }),
        prisma.conductFeedback.count({
          where: {
            authorUserId: actor.sub,
            authorType: ConductFeedbackAuthorType.GOV_AUDITOR,
          },
        }),
      ]);

    return {
      scope: {
        schoolsInScope,
        activeAssignments,
      },
      incidents: {
        total: totalIncidents,
        open: openIncidents,
        resolved: resolvedIncidents,
      },
      feedback: {
        authoredByMe,
      },
    };
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

  async listMarks(actor: JwtUser, query: ListGovConductMarksQueryInput) {
    this.assertGovMarksRuntimeReady();
    const access = await this.resolvePlatformAccess(actor);

    if (!access.schoolWhere) {
      return {
        items: [],
        pagination: buildPagination(query.page, query.pageSize, 0),
      };
    }

    const where = this.buildMarkWhere(access, query);
    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, marks] = await prisma.$transaction([
      prisma.conductMark.count({ where }),
      prisma.conductMark.findMany({
        where,
        skip,
        take: query.pageSize,
        include: conductMarkInclude,
        orderBy: [{ term: { startDate: 'desc' } }, { updatedAt: 'desc' }],
      }),
    ]);

    return {
      items: marks.map((mark) => this.mapConductMark(mark)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async addMarkFeedback(
    actor: JwtUser,
    markId: string,
    input: AddGovFeedbackInput,
    context: RequestAuditContext,
  ) {
    this.assertGovMarksRuntimeReady();
    const access = await this.resolvePlatformAccess(actor);
    const mark = await this.getScopedMarkOrThrow(access, {
      id: markId,
    });

    await prisma.conductFeedback.create({
      data: {
        tenantId: mark.tenantId,
        conductMarkId: mark.id,
        authorUserId: actor.sub,
        authorType: ConductFeedbackAuthorType.GOV_AUDITOR,
        body: input.body,
      },
    });

    await this.auditService.log({
      tenantId: mark.tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.CONDUCT_FEEDBACK_ADDED,
      entity: 'ConductMark',
      entityId: mark.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        authorType: ConductFeedbackAuthorType.GOV_AUDITOR,
      },
    });

    const refreshed = await this.getScopedMarkOrThrow(access, {
      id: mark.id,
    });

    return this.mapConductMark(refreshed);
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

  private assertGovMarksRuntimeReady() {
    const runtimePrisma = prisma as unknown as Record<string, unknown>;

    if (!runtimePrisma.conductMark || !runtimePrisma.conductFeedback) {
      throw new AppError(
        503,
        'GOV_MARK_RUNTIME_RESTART_REQUIRED',
        'Government conduct marks are running with an outdated Prisma client. Restart the backend after prisma generate.',
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

    const tenantId = query.tenantId ?? query.schoolId;
    if (tenantId) {
      where.tenantId = tenantId;
    }

    if (query.termId) {
      where.termId = query.termId;
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

  private buildMarkWhere(
    access: PlatformContext,
    query: ListGovConductMarksQueryInput,
  ): Prisma.ConductMarkWhereInput {
    const clauses: Prisma.ConductMarkWhereInput[] = [];

    if (!access.isSuperAdmin && access.schoolWhere) {
      clauses.push({
        tenant: {
          school: access.schoolWhere,
        },
      });
    }

    const tenantId = query.tenantId ?? query.schoolId;
    if (tenantId) {
      clauses.push({
        tenantId,
      });
    }

    if (query.termId) {
      clauses.push({
        termId: query.termId,
      });
    }

    if (query.from || query.to) {
      clauses.push({
        updatedAt: {
          ...(query.from ? { gte: new Date(query.from) } : {}),
          ...(query.to ? { lte: new Date(query.to) } : {}),
        },
      });
    }

    if (query.severity) {
      clauses.push({
        student: {
          conductIncidents: {
            some: {
              ...(query.termId ? { termId: query.termId } : {}),
              severity: query.severity as ConductSeverity,
            },
          },
        },
      });
    }

    if (query.q) {
      clauses.push({
        OR: [
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
        ],
      });
    }

    if (!clauses.length) {
      return {};
    }

    return {
      AND: clauses,
    };
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

  private async getScopedMarkOrThrow(
    access: PlatformContext,
    where: Prisma.ConductMarkWhereInput,
  ) {
    if (!access.schoolWhere) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'Conduct mark is outside the assigned scope');
    }

    const mark = await prisma.conductMark.findFirst({
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
      include: conductMarkInclude,
    });

    if (!mark) {
      throw new AppError(403, 'GOV_SCOPE_FORBIDDEN', 'Conduct mark is outside the assigned scope');
    }

    return mark;
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

  private mapConductMark(mark: ConductMarkRecord) {
    return {
      id: mark.id,
      tenantId: mark.tenantId,
      score: mark.score,
      maxScore: mark.maxScore,
      isLocked: mark.isLocked,
      computedFromIncidents: mark.computedFromIncidents,
      overrideReason: mark.overrideReason,
      lockedAt: mark.lockedAt,
      createdAt: mark.createdAt,
      updatedAt: mark.updatedAt,
      school: mark.tenant.school
        ? {
            id: mark.tenant.school.id,
            tenantId: mark.tenant.id,
            code: mark.tenant.code,
            displayName: mark.tenant.school.displayName,
            province: mark.tenant.school.province,
            district: mark.tenant.school.district,
            sector: mark.tenant.school.sector,
            country: mark.tenant.school.country,
          }
        : null,
      student: {
        id: mark.student.id,
        studentCode: mark.student.studentCode,
        firstName: mark.student.firstName,
        lastName: mark.student.lastName,
      },
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
      feedback: mark.feedback.map((entry) => ({
        id: entry.id,
        authorType: entry.authorType,
        body: entry.body,
        createdAt: entry.createdAt,
        updatedAt: entry.updatedAt,
        author: {
          id: entry.authorUser.id,
          firstName: entry.authorUser.firstName,
          lastName: entry.authorUser.lastName,
        },
      })),
    };
  }

  private mapAuditor(auditor: {
    id: string;
    email: string;
    firstName: string;
    lastName: string;
    phone: string | null;
    createdAt: Date;
    updatedAt: Date;
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
    }>;
  }) {
    return {
      id: auditor.id,
      email: auditor.email,
      firstName: auditor.firstName,
      lastName: auditor.lastName,
      phone: auditor.phone,
      createdAt: auditor.createdAt,
      updatedAt: auditor.updatedAt,
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
  }) {
    return {
      id: scope.id,
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
    };
  }
}

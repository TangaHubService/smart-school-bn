import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { prisma } from '../../db/prisma';
import { SUPER_ADMIN_AUDIT_EVENT_WHITELIST } from './audit.constants';
import { ListAuditLogsQueryInput } from './audit.schemas';

const auditLogInclude = {
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
} as const;

export class AuditListService {
  async listSuperAdmin(actor: JwtUser, query: ListAuditLogsQueryInput) {
    if (!actor.roles.includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can list activity logs');
    }

    const where = this.buildWhere(query, {
      defaultEvents: [...SUPER_ADMIN_AUDIT_EVENT_WHITELIST],
    });

    if (query.tenantId) {
      where.tenantId = query.tenantId;
    } else {
      where.tenant = {
        code: { not: 'platform' },
      };
    }

    return this.runListQuery(where, query);
  }

  async listTenant(actor: JwtUser, query: ListAuditLogsQueryInput) {
    const where = this.buildWhere(query, {
      tenantId: actor.tenantId,
    });

    return this.runListQuery(where, query);
  }

  private buildWhere(
    query: ListAuditLogsQueryInput,
    options: {
      tenantId?: string;
      defaultEvents?: string[];
    },
  ): Prisma.AuditLogWhereInput {
    const where: Prisma.AuditLogWhereInput = {};

    if (options.tenantId) {
      where.tenantId = options.tenantId;
    }

    if (query.event) {
      where.event = query.event;
    } else if (options.defaultEvents?.length) {
      where.event = { in: options.defaultEvents };
    }

    if (query.actorUserId) {
      where.actorUserId = query.actorUserId;
    }

    if (query.role) {
      where.actorRole = {
        equals: query.role,
        mode: 'insensitive',
      };
    }

    if (query.module) {
      where.module = {
        equals: query.module,
        mode: 'insensitive',
      };
    }

    if (query.actionType) {
      where.actionType = query.actionType;
    }

    if (query.status) {
      where.status = query.status;
    }

    if (query.sessionId) {
      where.sessionId = query.sessionId;
    }

    if (query.from || query.to) {
      where.createdAt = {};
      if (query.from) {
        where.createdAt.gte = new Date(query.from);
      }
      if (query.to) {
        where.createdAt.lte = new Date(query.to);
      }
    }

    if (query.search) {
      const search = query.search.trim();
      where.OR = [
        { event: { contains: search, mode: 'insensitive' } },
        { module: { contains: search, mode: 'insensitive' } },
        { description: { contains: search, mode: 'insensitive' } },
        { entity: { contains: search, mode: 'insensitive' } },
        { recordId: { contains: search, mode: 'insensitive' } },
        { actorName: { contains: search, mode: 'insensitive' } },
        { actorRole: { contains: search, mode: 'insensitive' } },
        { schoolName: { contains: search, mode: 'insensitive' } },
      ];
    }

    return where;
  }

  private async runListQuery(
    where: Prisma.AuditLogWhereInput,
    query: ListAuditLogsQueryInput,
  ) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;

    const [totalItems, rows] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: auditLogInclude,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((row) => {
        const actorName =
          row.actorName ??
          (`${row.actorUser?.firstName ?? ''} ${row.actorUser?.lastName ?? ''}`.trim() || null);
        const schoolName =
          row.schoolName ??
          row.tenant.school?.displayName ??
          row.tenant.name;
        const timestamp = row.createdAt.toISOString();

        return {
          id: String(row.id),
          event: row.event,
          actionType: row.actionType,
          module: row.module,
          description: row.description,
          entity: row.entity,
          entityId: row.entityId,
          recordId: row.recordId ?? row.entityId,
          createdAt: timestamp,
          timestamp,
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
          schoolName,
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
      pagination: buildPagination(page, pageSize, totalItems),
    };
  }
}

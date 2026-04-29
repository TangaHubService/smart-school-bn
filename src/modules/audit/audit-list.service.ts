import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { prisma } from '../../db/prisma';
import { SUPER_ADMIN_AUDIT_EVENT_WHITELIST } from './audit.constants';
import { ListAuditLogsQueryInput } from './audit.schemas';

export class AuditListService {
  async listSuperAdmin(actor: JwtUser, query: ListAuditLogsQueryInput) {
    if (!actor.roles.includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can list activity logs');
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;

    const where: Prisma.AuditLogWhereInput = {
      ...(query.event
        ? { event: query.event }
        : { event: { in: [...SUPER_ADMIN_AUDIT_EVENT_WHITELIST] } }),
    };

    if (query.tenantId) {
      where.tenantId = query.tenantId;
    } else {
      where.tenant = {
        code: { not: 'platform' },
      };
    }

    if (query.actorUserId) {
      where.actorUserId = query.actorUserId;
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
      const s = query.search.trim();
      where.OR = [
        { event: { contains: s, mode: 'insensitive' } },
        { entity: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [totalItems, rows] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
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
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: String(r.id),
        event: r.event,
        entity: r.entity,
        entityId: r.entityId,
        createdAt: r.createdAt.toISOString(),
        ipAddress: r.ipAddress,
        actor: r.actorUser
          ? {
              id: r.actorUser.id,
              email: r.actorUser.email,
              name: `${r.actorUser.firstName} ${r.actorUser.lastName}`.trim(),
            }
          : null,
        tenant: {
          id: r.tenant.id,
          code: r.tenant.code,
          name: r.tenant.name,
        },
        payload: r.payload,
      })),
      pagination: buildPagination(page, pageSize, totalItems),
    };
  }

  async listTenant(actor: JwtUser, query: ListAuditLogsQueryInput) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 30;

    const where: Prisma.AuditLogWhereInput = {
      tenantId: actor.tenantId,
    };

    if (query.event) {
      where.event = query.event;
    }

    if (query.actorUserId) {
      where.actorUserId = query.actorUserId;
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
      const s = query.search.trim();
      where.OR = [
        { event: { contains: s, mode: 'insensitive' } },
        { entity: { contains: s, mode: 'insensitive' } },
      ];
    }

    const [totalItems, rows] = await prisma.$transaction([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        include: {
          actorUser: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: rows.map((r) => ({
        id: String(r.id),
        event: r.event,
        entity: r.entity,
        entityId: r.entityId,
        createdAt: r.createdAt.toISOString(),
        ipAddress: r.ipAddress,
        actor: r.actorUser
          ? {
              id: r.actorUser.id,
              email: r.actorUser.email,
              name: `${r.actorUser.firstName} ${r.actorUser.lastName}`.trim(),
            }
          : null,
        payload: r.payload,
      })),
      pagination: buildPagination(page, pageSize, totalItems),
    };
  }
}

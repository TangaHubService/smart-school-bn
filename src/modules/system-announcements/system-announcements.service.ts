import {
  Prisma,
  SystemAnnouncementStatus,
  SystemAnnouncementTarget,
} from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  createSystemAnnouncementSchema,
  listSystemAnnouncementsQuerySchema,
  updateSystemAnnouncementSchema,
} from './system-announcements.schemas';
import { z } from 'zod';

type CreateInput = z.infer<typeof createSystemAnnouncementSchema>;
type UpdateInput = z.infer<typeof updateSystemAnnouncementSchema>;
type ListQuery = z.infer<typeof listSystemAnnouncementsQuerySchema>;

export function isSystemAnnouncementVisible(
  targetType: SystemAnnouncementTarget,
  targetTenantIds: string[],
  targetRoleNames: string[],
  tenantId: string,
  viewerRoleNames: string[],
): boolean {
  switch (targetType) {
    case SystemAnnouncementTarget.ALL_SCHOOLS:
      return true;
    case SystemAnnouncementTarget.SPECIFIC_SCHOOLS:
      return targetTenantIds.includes(tenantId);
    case SystemAnnouncementTarget.SPECIFIC_ROLES:
      return viewerRoleNames.some((r) => targetRoleNames.includes(r));
    case SystemAnnouncementTarget.SCHOOLS_AND_ROLES:
      return (
        targetTenantIds.includes(tenantId) &&
        viewerRoleNames.some((r) => targetRoleNames.includes(r))
      );
    default:
      return false;
  }
}

export class SystemAnnouncementsService {
  private readonly auditService = new AuditService();

  async listVisibleForViewer(tenantId: string, viewerRoleNames: string[]) {
    const now = new Date();
    const rows = await prisma.systemAnnouncement.findMany({
      where: {
        status: SystemAnnouncementStatus.PUBLISHED,
        publishedAt: { lte: now },
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      include: {
        author: {
          select: { id: true, firstName: true, lastName: true },
        },
      },
      orderBy: { publishedAt: 'desc' },
      take: 50,
    });

    const items = rows.filter((row) =>
      isSystemAnnouncementVisible(
        row.targetType,
        row.targetTenantIds,
        row.targetRoleNames,
        tenantId,
        viewerRoleNames,
      ),
    );

    return items.map((a) => ({
      id: a.id,
      title: a.title,
      body: a.body,
      source: 'system' as const,
      targetType: a.targetType,
      publishedAt: a.publishedAt?.toISOString() ?? null,
      expiresAt: a.expiresAt?.toISOString() ?? null,
      author: a.author,
    }));
  }

  async list(actor: JwtUser, query: ListQuery) {
    const roles = actor.roles ?? [];
    if (!roles.includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can manage system announcements');
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where =
      query.status != null
        ? { status: query.status }
        : {};

    try {
      const [totalItems, rows] = await prisma.$transaction([
        prisma.systemAnnouncement.count({ where }),
        prisma.systemAnnouncement.findMany({
          where,
          include: {
            author: {
              select: { id: true, firstName: true, lastName: true, email: true },
            },
          },
          orderBy: { updatedAt: 'desc' },
          skip: (page - 1) * pageSize,
          take: pageSize,
        }),
      ]);

      return {
        items: rows.map((a) => ({
          id: a.id,
          title: a.title,
          body: a.body,
          status: a.status,
          targetType: a.targetType,
          targetTenantIds: a.targetTenantIds,
          targetRoleNames: a.targetRoleNames,
          publishedAt: a.publishedAt?.toISOString() ?? null,
          expiresAt: a.expiresAt?.toISOString() ?? null,
          createdAt: a.createdAt.toISOString(),
          updatedAt: a.updatedAt.toISOString(),
          author: a.author,
        })),
        pagination: buildPagination(page, pageSize, totalItems),
      };
    } catch (e) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021') {
        throw new AppError(
          503,
          'SCHEMA_NOT_READY',
          'System announcements are not available until database migrations are applied (SystemAnnouncement table missing).',
        );
      }
      throw e;
    }
  }

  async create(actor: JwtUser, input: CreateInput, context: RequestAuditContext) {
    if (!(actor.roles ?? []).includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can create system announcements');
    }

    const publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    const tenant = await prisma.tenant.findFirst({
      where: { code: 'platform' },
      select: { id: true },
    });

    if (!tenant) {
      throw new AppError(500, 'PLATFORM_TENANT_MISSING', 'Platform tenant not found');
    }

    const created = await prisma.systemAnnouncement.create({
      data: {
        authorUserId: actor.sub,
        title: input.title,
        body: input.body,
        status: input.status,
        targetType: input.targetType,
        targetTenantIds: input.targetTenantIds,
        targetRoleNames: input.targetRoleNames,
        publishedAt:
          input.status === SystemAnnouncementStatus.PUBLISHED
            ? publishedAt ?? new Date()
            : publishedAt,
        expiresAt,
      },
    });

    await this.auditService.log({
      tenantId: tenant.id,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.SYSTEM_ANNOUNCEMENT_CREATED,
      entity: 'SystemAnnouncement',
      entityId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { title: created.title, targetType: created.targetType },
    });

    return { id: created.id };
  }

  async update(
    id: string,
    actor: JwtUser,
    input: UpdateInput,
    context: RequestAuditContext,
  ) {
    if (!(actor.roles ?? []).includes('SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Only super admins can update system announcements');
    }

    const existing = await prisma.systemAnnouncement.findFirst({ where: { id } });
    if (!existing) {
      throw new AppError(404, 'NOT_FOUND', 'Announcement not found');
    }

    const parsed = updateSystemAnnouncementSchema.parse(input);

    await prisma.systemAnnouncement.update({
      where: { id },
      data: {
        ...(parsed.title !== undefined && { title: parsed.title }),
        ...(parsed.body !== undefined && { body: parsed.body }),
        ...(parsed.targetType !== undefined && { targetType: parsed.targetType }),
        ...(parsed.targetTenantIds !== undefined && { targetTenantIds: parsed.targetTenantIds }),
        ...(parsed.targetRoleNames !== undefined && { targetRoleNames: parsed.targetRoleNames }),
        ...(parsed.status !== undefined && { status: parsed.status }),
        ...(parsed.publishedAt !== undefined && {
          publishedAt: parsed.publishedAt ? new Date(parsed.publishedAt) : null,
        }),
        ...(parsed.expiresAt !== undefined && {
          expiresAt: parsed.expiresAt ? new Date(parsed.expiresAt) : null,
        }),
      },
    });

    const platform = await prisma.tenant.findFirst({
      where: { code: 'platform' },
      select: { id: true },
    });

    if (platform) {
      await this.auditService.log({
        tenantId: platform.id,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.SYSTEM_ANNOUNCEMENT_UPDATED,
        entity: 'SystemAnnouncement',
        entityId: id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: { fields: Object.keys(parsed) },
      });
    }

    return { id };
  }
}

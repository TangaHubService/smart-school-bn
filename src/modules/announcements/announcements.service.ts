import { AnnouncementAudience } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { RequestAuditContext } from '../../common/types/auth.types';
import { JwtUser } from '../../common/types/auth.types';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { buildPagination } from '../../common/utils/pagination';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { SystemAnnouncementsService } from '../system-announcements/system-announcements.service';
import {
  CreateAnnouncementInput,
  ListAnnouncementsQueryInput,
  UpdateAnnouncementInput,
} from './announcements.schemas';

const announcementInclude = {
  author: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
};

export class AnnouncementsService {
  private readonly auditService = new AuditService();
  private readonly systemAnnouncements = new SystemAnnouncementsService();

  async list(
    tenantId: string,
    query: ListAnnouncementsQueryInput,
    actor?: JwtUser,
  ) {
    const where: Record<string, unknown> = {
      tenantId,
    };

    if (query.audience) {
      where.audience = query.audience;
    }

    if (query.publishedOnly) {
      where.publishedAt = { not: null };
      where.OR = [
        { expiresAt: null },
        { expiresAt: { gt: new Date() } },
      ];
    }

    if (query.classRoomId) {
      where.targetClassRoomIds = { has: query.classRoomId };
    }

    if (query.gradeLevelId) {
      where.targetGradeLevelIds = { has: query.gradeLevelId };
    }

    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, items] = await prisma.$transaction([
      prisma.announcement.count({ where: where as never }),
      prisma.announcement.findMany({
        where: where as never,
        skip,
        take: query.pageSize,
        include: announcementInclude,
        orderBy: { createdAt: 'desc' },
      }),
    ]);

    const systemBroadcasts = await this.systemAnnouncements.listVisibleForViewer(
      tenantId,
      actor?.roles ?? [],
    );

    return {
      items: items.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        audience: a.audience,
        targetClassRoomIds: a.targetClassRoomIds,
        targetGradeLevelIds: a.targetGradeLevelIds,
        publishedAt: a.publishedAt?.toISOString() ?? null,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        createdAt: a.createdAt.toISOString(),
        updatedAt: a.updatedAt.toISOString(),
        author: a.author,
      })),
      systemBroadcasts,
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async listForStudent(
    tenantId: string,
    studentId: string,
    query: { page?: number; pageSize?: number },
  ) {
    const enrollment = await prisma.studentEnrollment.findFirst({
      where: {
        tenantId,
        studentId,
        isActive: true,
      },
      select: {
        classRoomId: true,
        classRoom: { select: { gradeLevelId: true } },
      },
    });

    const classRoomId = enrollment?.classRoomId;
    const gradeLevelId = enrollment?.classRoom?.gradeLevelId;

    const audienceConditions = [
      { audience: AnnouncementAudience.ALL },
      ...(classRoomId
        ? [{ audience: AnnouncementAudience.CLASS_ROOM, targetClassRoomIds: { has: classRoomId } }]
        : []),
      ...(gradeLevelId
        ? [{ audience: AnnouncementAudience.GRADE_LEVEL, targetGradeLevelIds: { has: gradeLevelId } }]
        : []),
    ];

    const where = {
      tenantId,
      publishedAt: { not: null },
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      AND: [{ OR: audienceConditions }],
    };

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [totalItems, items] = await prisma.$transaction([
      prisma.announcement.count({ where: where as never }),
      prisma.announcement.findMany({
        where: where as never,
        skip,
        take: pageSize,
        include: announcementInclude,
        orderBy: { publishedAt: 'desc' },
      }),
    ]);

    const systemBroadcasts = await this.systemAnnouncements.listVisibleForViewer(tenantId, ['STUDENT']);

    return {
      items: items.map((a) => ({
        id: a.id,
        title: a.title,
        body: a.body,
        audience: a.audience,
        publishedAt: a.publishedAt?.toISOString() ?? null,
        expiresAt: a.expiresAt?.toISOString() ?? null,
        author: a.author,
      })),
      systemBroadcasts,
      pagination: buildPagination(page, pageSize, totalItems),
    };
  }

  async getById(tenantId: string, id: string) {
    const a = await prisma.announcement.findFirst({
      where: { id, tenantId },
      include: announcementInclude,
    });

    if (!a) {
      throw new AppError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found');
    }

    return {
      id: a.id,
      title: a.title,
      body: a.body,
      audience: a.audience,
      targetClassRoomIds: a.targetClassRoomIds,
      targetGradeLevelIds: a.targetGradeLevelIds,
      publishedAt: a.publishedAt?.toISOString() ?? null,
      expiresAt: a.expiresAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      author: a.author,
    };
  }

  async create(
    tenantId: string,
    input: CreateAnnouncementInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    const created = await prisma.announcement.create({
      data: {
        tenantId,
        title: input.title,
        body: input.body,
        authorUserId: actor.sub,
        audience: input.audience,
        targetClassRoomIds: input.targetClassRoomIds,
        targetGradeLevelIds: input.targetGradeLevelIds,
        publishedAt,
        expiresAt,
      },
      include: announcementInclude,
    });

    await this.auditService.logActivity({
      tenantId,
      actor: { userId: actor.sub },
      event: AUDIT_EVENT.ANNOUNCEMENT_CREATED,
      module: 'Announcements',
      description: `Created announcement "${created.title}"`,
      entity: 'Announcement',
      entityId: created.id,
      recordId: created.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      sessionId: context.sessionId,
      newValue: this.summarizeAnnouncement(created),
    });

    return this.getById(tenantId, created.id);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateAnnouncementInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const existing = await prisma.announcement.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found');
    }

    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        ...(input.title != null && { title: input.title }),
        ...(input.body != null && { body: input.body }),
        ...(input.audience != null && { audience: input.audience }),
        ...(input.targetClassRoomIds != null && { targetClassRoomIds: input.targetClassRoomIds }),
        ...(input.targetGradeLevelIds != null && { targetGradeLevelIds: input.targetGradeLevelIds }),
        ...(input.publishedAt !== undefined && {
          publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
        }),
        ...(input.expiresAt !== undefined && {
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        }),
      },
      include: announcementInclude,
    });

    await this.auditService.logActivity({
      tenantId,
      actor: { userId: actor.sub },
      event: AUDIT_EVENT.ANNOUNCEMENT_UPDATED,
      module: 'Announcements',
      description: `Updated announcement "${updated.title}"`,
      entity: 'Announcement',
      entityId: updated.id,
      recordId: updated.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      sessionId: context.sessionId,
      oldValue: this.summarizeAnnouncement(existing),
      newValue: this.summarizeAnnouncement(updated),
    });

    return this.getById(tenantId, id);
  }

  async delete(
    tenantId: string,
    id: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const existing = await prisma.announcement.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found');
    }

    await prisma.announcement.delete({
      where: { id },
    });

    await this.auditService.logActivity({
      tenantId,
      actor: { userId: actor.sub },
      event: AUDIT_EVENT.ANNOUNCEMENT_DELETED,
      module: 'Announcements',
      description: `Deleted announcement "${existing.title}"`,
      entity: 'Announcement',
      entityId: existing.id,
      recordId: existing.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      sessionId: context.sessionId,
      oldValue: this.summarizeAnnouncement(existing),
    });

    return { deleted: true };
  }

  private summarizeAnnouncement(input: {
    id: string;
    title: string;
    body: string;
    audience: AnnouncementAudience;
    targetClassRoomIds: string[];
    targetGradeLevelIds: string[];
    publishedAt: Date | null;
    expiresAt: Date | null;
  }) {
    return {
      id: input.id,
      title: input.title,
      body: input.body,
      audience: input.audience,
      targetClassRoomIds: input.targetClassRoomIds,
      targetGradeLevelIds: input.targetGradeLevelIds,
      publishedAt: input.publishedAt?.toISOString() ?? null,
      expiresAt: input.expiresAt?.toISOString() ?? null,
    };
  }
}

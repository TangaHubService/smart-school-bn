import { AnnouncementAudience } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { RequestAuditContext } from '../../common/types/auth.types';
import { JwtUser } from '../../common/types/auth.types';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { buildPagination } from '../../common/utils/pagination';
import { isProtectedPdfAsset } from '../../common/utils/protected-attachment';
import { upsertFileAssetIds } from '../../common/services/file-asset-upsert.service';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { SystemAnnouncementsService } from '../system-announcements/system-announcements.service';
import {
  AnnouncementAttachmentUploadInput,
  CreateAnnouncementInput,
  ListAnnouncementsQueryInput,
  ListMyAnnouncementsQueryInput,
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
  attachments: {
    include: { fileAsset: true },
  },
} as const;

export class AnnouncementsService {
  private readonly auditService = new AuditService();
  private readonly systemAnnouncements = new SystemAnnouncementsService();
  private readonly emailService = new EmailService();

  async list(tenantId: string, query: ListAnnouncementsQueryInput, actor?: JwtUser) {
    const where: Record<string, unknown> = {
      tenantId,
    };

    if (query.audience) {
      where.audience = query.audience;
    }

    if (query.publishedOnly) {
      where.publishedAt = { lte: new Date() };
      where.OR = [{ expiresAt: null }, { expiresAt: { gt: new Date() } }];
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
      actor?.roles ?? []
    );

    return {
      items: items.map(a => this.mapAnnouncement(a)),
      systemBroadcasts,
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  /** Announcements visible to the calling user, scoped by their role and enrollment/teaching assignments. */
  async listForViewer(tenantId: string, actor: JwtUser, query: ListMyAnnouncementsQueryInput) {
    const now = new Date();
    const audienceConditions = await this.buildViewerAudienceConditions(tenantId, actor);

    const where: Record<string, unknown> = {
      tenantId,
      publishedAt: { lte: now },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [{ OR: audienceConditions }],
    };

    if (query.unreadOnly) {
      where.reads = { none: { userId: actor.sub } };
    }

    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const skip = (page - 1) * pageSize;

    const [totalItems, items] = await prisma.$transaction([
      prisma.announcement.count({ where: where as never }),
      prisma.announcement.findMany({
        where: where as never,
        skip,
        take: pageSize,
        include: {
          ...announcementInclude,
          reads: { where: { userId: actor.sub }, select: { readAt: true } },
        },
        orderBy: [{ publishedAt: 'desc' }],
      }),
    ]);

    const systemBroadcasts = await this.systemAnnouncements.listVisibleForViewer(
      tenantId,
      actor.roles ?? []
    );

    return {
      items: items.map(a => this.mapAnnouncement(a, actor.sub)),
      systemBroadcasts,
      pagination: buildPagination(page, pageSize, totalItems),
    };
  }

  async markRead(tenantId: string, id: string, actor: JwtUser) {
    const announcement = await prisma.announcement.findFirst({ where: { id, tenantId } });
    if (!announcement) {
      throw new AppError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found');
    }

    await prisma.announcementRead.upsert({
      where: { announcementId_userId: { announcementId: id, userId: actor.sub } },
      update: {},
      create: { tenantId, announcementId: id, userId: actor.sub },
    });

    return { read: true };
  }

  async getById(tenantId: string, id: string, actor?: JwtUser) {
    const a = await prisma.announcement.findFirst({
      where: { id, tenantId },
      include: actor
        ? {
            ...announcementInclude,
            reads: { where: { userId: actor.sub }, select: { readAt: true } },
          }
        : announcementInclude,
    });

    if (!a) {
      throw new AppError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found');
    }

    return this.mapAnnouncement(a, actor?.sub);
  }

  async create(
    tenantId: string,
    input: CreateAnnouncementInput,
    actor: JwtUser,
    context: RequestAuditContext
  ) {
    const publishedAt = input.publishedAt ? new Date(input.publishedAt) : null;
    const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;

    const attachmentAssetIds = await this.upsertAttachmentAssets(
      tenantId,
      input.attachments,
      actor.sub
    );

    const created = await prisma.announcement.create({
      data: {
        tenantId,
        title: input.title,
        body: input.body,
        authorUserId: actor.sub,
        audience: input.audience,
        priority: input.priority,
        targetClassRoomIds: input.targetClassRoomIds,
        targetGradeLevelIds: input.targetGradeLevelIds,
        targetSubjectIds: input.targetSubjectIds,
        targetRoleNames: input.targetRoleNames,
        targetUserIds: input.targetUserIds,
        emailNotify: input.emailNotify,
        publishedAt,
        expiresAt,
        attachments: attachmentAssetIds.length
          ? { create: attachmentAssetIds.map(fileAssetId => ({ tenantId, fileAssetId })) }
          : undefined,
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

    if (created.emailNotify && created.publishedAt && created.publishedAt.getTime() <= Date.now()) {
      void this.dispatchEmailNotifications(tenantId, created);
    }

    return this.getById(tenantId, created.id, actor);
  }

  async update(
    tenantId: string,
    id: string,
    input: UpdateAnnouncementInput,
    actor: JwtUser,
    context: RequestAuditContext
  ) {
    const existing = await prisma.announcement.findFirst({
      where: { id, tenantId },
    });

    if (!existing) {
      throw new AppError(404, 'ANNOUNCEMENT_NOT_FOUND', 'Announcement not found');
    }

    const attachmentAssetIds =
      input.attachments !== undefined
        ? await this.upsertAttachmentAssets(tenantId, input.attachments, actor.sub)
        : undefined;

    const updated = await prisma.announcement.update({
      where: { id },
      data: {
        ...(input.title != null && { title: input.title }),
        ...(input.body != null && { body: input.body }),
        ...(input.audience != null && { audience: input.audience }),
        ...(input.priority != null && { priority: input.priority }),
        ...(input.targetClassRoomIds != null && { targetClassRoomIds: input.targetClassRoomIds }),
        ...(input.targetGradeLevelIds != null && {
          targetGradeLevelIds: input.targetGradeLevelIds,
        }),
        ...(input.targetSubjectIds != null && { targetSubjectIds: input.targetSubjectIds }),
        ...(input.targetRoleNames != null && { targetRoleNames: input.targetRoleNames }),
        ...(input.targetUserIds != null && { targetUserIds: input.targetUserIds }),
        ...(input.emailNotify != null && { emailNotify: input.emailNotify }),
        ...(input.publishedAt !== undefined && {
          publishedAt: input.publishedAt ? new Date(input.publishedAt) : null,
        }),
        ...(input.expiresAt !== undefined && {
          expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        }),
        ...(attachmentAssetIds !== undefined && {
          attachments: {
            deleteMany: {},
            create: attachmentAssetIds.map(fileAssetId => ({ tenantId, fileAssetId })),
          },
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

    const wasAlreadyPublished = Boolean(
      existing.publishedAt && existing.publishedAt.getTime() <= Date.now()
    );
    const isNowPublished = Boolean(
      updated.publishedAt && updated.publishedAt.getTime() <= Date.now()
    );
    if (updated.emailNotify && isNowPublished && !wasAlreadyPublished) {
      void this.dispatchEmailNotifications(tenantId, updated);
    }

    return this.getById(tenantId, id, actor);
  }

  async delete(tenantId: string, id: string, actor: JwtUser, context: RequestAuditContext) {
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

  private async upsertAttachmentAssets(
    tenantId: string,
    uploads: AnnouncementAttachmentUploadInput[],
    uploadedByUserId: string
  ): Promise<string[]> {
    return upsertFileAssetIds(tenantId, uploads, uploadedByUserId);
  }

  /**
   * OR-conditions for "does this announcement's audience include this viewer" — always
   * includes ALL, role-name, and individual-user matches, plus (for students and teachers)
   * conditions derived from their actual enrollment/teaching assignments.
   */
  private async buildViewerAudienceConditions(tenantId: string, actor: JwtUser) {
    const roles = actor.roles ?? [];
    const conditions: Record<string, unknown>[] = [{ audience: AnnouncementAudience.ALL }];

    if (roles.length) {
      conditions.push({
        audience: AnnouncementAudience.SPECIFIC_ROLES,
        targetRoleNames: { hasSome: roles },
      });
    }

    conditions.push({
      audience: AnnouncementAudience.INDIVIDUAL_USERS,
      targetUserIds: { has: actor.sub },
    });

    if (roles.includes('STUDENT')) {
      const student = await prisma.student.findFirst({
        where: { tenantId, userId: actor.sub, deletedAt: null },
        select: {
          id: true,
          enrollments: {
            where: { isActive: true },
            take: 1,
            select: { classRoomId: true, classRoom: { select: { gradeLevelId: true } } },
          },
        },
      });

      if (student) {
        const enrollment = student.enrollments[0];

        if (enrollment) {
          conditions.push({
            audience: AnnouncementAudience.CLASS_ROOM,
            targetClassRoomIds: { has: enrollment.classRoomId },
          });
          if (enrollment.classRoom?.gradeLevelId) {
            conditions.push({
              audience: AnnouncementAudience.GRADE_LEVEL,
              targetGradeLevelIds: { has: enrollment.classRoom.gradeLevelId },
            });
          }

          const courses = await prisma.course.findMany({
            where: {
              tenantId,
              classRoomId: enrollment.classRoomId,
              isActive: true,
              subjectId: { not: null },
            },
            select: { subjectId: true },
          });
          const subjectIds = [...new Set(courses.map(c => c.subjectId).filter(Boolean))] as string[];
          if (subjectIds.length) {
            conditions.push({
              audience: AnnouncementAudience.SUBJECT,
              targetSubjectIds: { hasSome: subjectIds },
            });
          }
        }
      }
    }

    if (roles.includes('TEACHER')) {
      const taughtCourses = await prisma.course.findMany({
        where: { tenantId, teacherUserId: actor.sub, isActive: true },
        select: { classRoomId: true, subjectId: true, classRoom: { select: { gradeLevelId: true } } },
      });

      const classRoomIds = [...new Set(taughtCourses.map(c => c.classRoomId))];
      const gradeLevelIds = [
        ...new Set(taughtCourses.map(c => c.classRoom?.gradeLevelId).filter(Boolean)),
      ] as string[];
      const subjectIds = [...new Set(taughtCourses.map(c => c.subjectId).filter(Boolean))] as string[];

      if (classRoomIds.length) {
        conditions.push({
          audience: AnnouncementAudience.CLASS_ROOM,
          targetClassRoomIds: { hasSome: classRoomIds },
        });
      }
      if (gradeLevelIds.length) {
        conditions.push({
          audience: AnnouncementAudience.GRADE_LEVEL,
          targetGradeLevelIds: { hasSome: gradeLevelIds },
        });
      }
      if (subjectIds.length) {
        conditions.push({
          audience: AnnouncementAudience.SUBJECT,
          targetSubjectIds: { hasSome: subjectIds },
        });
      }
    }

    return conditions;
  }

  /** Best-effort email fan-out; failures are logged, never thrown back to the caller. */
  private async dispatchEmailNotifications(
    tenantId: string,
    announcement: {
      id: string;
      title: string;
      body: string;
      priority: string;
      expiresAt: Date | null;
      audience: AnnouncementAudience;
      targetClassRoomIds: string[];
      targetGradeLevelIds: string[];
      targetSubjectIds: string[];
      targetRoleNames: string[];
      targetUserIds: string[];
    }
  ) {
    try {
      const recipients = await this.resolveEmailRecipients(tenantId, announcement);
      await Promise.all(
        recipients.map(recipient =>
          this.emailService.sendAnnouncementNotification({
            toEmail: recipient.email,
            title: announcement.title,
            body: announcement.body,
            priority: announcement.priority,
            expiresAt: announcement.expiresAt,
          })
        )
      );
    } catch (error) {
      // eslint-disable-next-line no-console
      console.error('[Announcements] Failed to send email notifications', {
        announcementId: announcement.id,
        error,
      });
    }
  }

  private async resolveEmailRecipients(
    tenantId: string,
    announcement: {
      audience: AnnouncementAudience;
      targetClassRoomIds: string[];
      targetGradeLevelIds: string[];
      targetSubjectIds: string[];
      targetRoleNames: string[];
      targetUserIds: string[];
    }
  ): Promise<Array<{ id: string; email: string }>> {
    const activeUserWhere = { status: 'ACTIVE' as const, deletedAt: null };

    switch (announcement.audience) {
      case AnnouncementAudience.ALL:
        return prisma.user.findMany({
          where: { tenantId, ...activeUserWhere },
          select: { id: true, email: true },
        });

      case AnnouncementAudience.INDIVIDUAL_USERS:
        if (!announcement.targetUserIds.length) return [];
        return prisma.user.findMany({
          where: { tenantId, id: { in: announcement.targetUserIds }, ...activeUserWhere },
          select: { id: true, email: true },
        });

      case AnnouncementAudience.SPECIFIC_ROLES:
        if (!announcement.targetRoleNames.length) return [];
        return prisma.user.findMany({
          where: {
            tenantId,
            ...activeUserWhere,
            userRoles: { some: { role: { name: { in: announcement.targetRoleNames } } } },
          },
          select: { id: true, email: true },
        });

      case AnnouncementAudience.CLASS_ROOM:
      case AnnouncementAudience.GRADE_LEVEL:
      case AnnouncementAudience.SUBJECT:
        return this.resolveClassScopedRecipients(tenantId, announcement);

      default:
        return [];
    }
  }

  private async resolveClassScopedRecipients(
    tenantId: string,
    announcement: {
      audience: AnnouncementAudience;
      targetClassRoomIds: string[];
      targetGradeLevelIds: string[];
      targetSubjectIds: string[];
    }
  ): Promise<Array<{ id: string; email: string }>> {
    const recipients = new Map<string, { id: string; email: string }>();

    let classRoomIds = announcement.targetClassRoomIds;
    if (announcement.audience === AnnouncementAudience.GRADE_LEVEL) {
      if (!announcement.targetGradeLevelIds.length) return [];
      const classRooms = await prisma.classRoom.findMany({
        where: { tenantId, gradeLevelId: { in: announcement.targetGradeLevelIds } },
        select: { id: true },
      });
      classRoomIds = classRooms.map(c => c.id);
    } else if (announcement.audience === AnnouncementAudience.SUBJECT) {
      if (!announcement.targetSubjectIds.length) return [];
      const courses = await prisma.course.findMany({
        where: { tenantId, isActive: true, subjectId: { in: announcement.targetSubjectIds } },
        select: { classRoomId: true, teacherUserId: true },
      });
      classRoomIds = [...new Set(courses.map(c => c.classRoomId))];

      const teachers = await prisma.user.findMany({
        where: {
          tenantId,
          status: 'ACTIVE',
          deletedAt: null,
          id: { in: [...new Set(courses.map(c => c.teacherUserId))] },
        },
        select: { id: true, email: true },
      });
      for (const t of teachers) recipients.set(t.id, t);
    } else if (!classRoomIds.length) {
      return [];
    }

    if (classRoomIds.length) {
      // Subject-specific teachers were already added above — adding every teacher of the
      // classroom here would email teachers of unrelated subjects too.
      const includeClassroomTeachers = announcement.audience !== AnnouncementAudience.SUBJECT;

      const [students, teachers] = await Promise.all([
        prisma.student.findMany({
          where: {
            tenantId,
            userId: { not: null },
            isActive: true,
            enrollments: { some: { isActive: true, classRoomId: { in: classRoomIds } } },
          },
          select: { user: { select: { id: true, email: true } } },
        }),
        includeClassroomTeachers
          ? prisma.user.findMany({
              where: {
                tenantId,
                status: 'ACTIVE',
                deletedAt: null,
                taughtCourses: { some: { classRoomId: { in: classRoomIds }, isActive: true } },
              },
              select: { id: true, email: true },
            })
          : Promise.resolve([]),
      ]);

      for (const s of students) {
        if (s.user) recipients.set(s.user.id, s.user);
      }
      for (const t of teachers) recipients.set(t.id, t);
    }

    return [...recipients.values()];
  }

  private mapAnnouncement(
    a: {
      id: string;
      title: string;
      body: string;
      audience: AnnouncementAudience;
      priority: string;
      targetClassRoomIds: string[];
      targetGradeLevelIds: string[];
      targetSubjectIds: string[];
      targetRoleNames: string[];
      targetUserIds: string[];
      emailNotify: boolean;
      publishedAt: Date | null;
      expiresAt: Date | null;
      createdAt: Date;
      updatedAt: Date;
      author: { id: string; firstName: string; lastName: string };
      attachments?: Array<{
        fileAsset: {
          id: string;
          originalName: string;
          mimeType: string | null;
          bytes: number | null;
          secureUrl: string;
        };
      }>;
      reads?: Array<{ readAt: Date }>;
    },
    viewerUserId?: string
  ) {
    return {
      id: a.id,
      title: a.title,
      body: a.body,
      audience: a.audience,
      priority: a.priority,
      targetClassRoomIds: a.targetClassRoomIds,
      targetGradeLevelIds: a.targetGradeLevelIds,
      targetSubjectIds: a.targetSubjectIds,
      targetRoleNames: a.targetRoleNames,
      targetUserIds: a.targetUserIds,
      emailNotify: a.emailNotify,
      publishedAt: a.publishedAt?.toISOString() ?? null,
      expiresAt: a.expiresAt?.toISOString() ?? null,
      createdAt: a.createdAt.toISOString(),
      updatedAt: a.updatedAt.toISOString(),
      author: a.author,
      attachments: (a.attachments ?? []).map(att => ({
        id: att.fileAsset.id,
        originalName: att.fileAsset.originalName,
        mimeType: att.fileAsset.mimeType,
        bytes: att.fileAsset.bytes,
        secureUrl: isProtectedPdfAsset(att.fileAsset.mimeType) ? null : att.fileAsset.secureUrl,
      })),
      ...(viewerUserId !== undefined
        ? {
            isRead: Boolean(a.reads?.length),
            readAt: a.reads?.[0]?.readAt?.toISOString() ?? null,
          }
        : {}),
    };
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

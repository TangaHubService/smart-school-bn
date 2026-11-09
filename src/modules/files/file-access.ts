import { JwtUser } from '../../common/types/auth.types';
import { PERMISSIONS } from '../../constants/permissions';
import { prisma } from '../../db/prisma';
import { AnnouncementsService } from '../announcements/announcements.service';

const announcementsService = new AnnouncementsService();

function isStaffReader(actor: JwtUser): boolean {
  const roles = actor.roles ?? [];
  if (roles.includes('SUPER_ADMIN')) return true;
  return (actor.permissions ?? []).includes(PERMISSIONS.COURSES_READ);
}

/**
 * Class rooms whose learning material this viewer may see: their own active
 * school enrollment, their Public Academy class enrollments, or — for parents —
 * their linked children's enrollments.
 */
async function resolveViewerClassRoomIds(tenantId: string, actor: JwtUser): Promise<string[]> {
  const classRoomIds = new Set<string>();

  const [ownEnrollments, academyEnrollments, parent] = await Promise.all([
    prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        isActive: true,
        student: { userId: actor.sub, deletedAt: null },
      },
      select: { classRoomId: true },
    }),
    prisma.classEnrollment.findMany({
      where: { tenantId, userId: actor.sub, isActive: true },
      select: { classRoomId: true },
    }),
    prisma.parent.findFirst({
      where: { tenantId, userId: actor.sub },
      select: { id: true },
    }),
  ]);

  ownEnrollments.forEach(row => classRoomIds.add(row.classRoomId));
  academyEnrollments.forEach(row => classRoomIds.add(row.classRoomId));

  if (parent) {
    const childEnrollments = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        isActive: true,
        student: {
          deletedAt: null,
          parentLinks: { some: { parentId: parent.id, deletedAt: null } },
        },
      },
      select: { classRoomId: true },
    });
    childEnrollments.forEach(row => classRoomIds.add(row.classRoomId));
  }

  return [...classRoomIds];
}

/**
 * Decides whether `actor` may read file `assetId` (already known to belong to
 * `tenantId`). Staff readers keep school-wide access; everyone else may read a
 * file only through something they can already see: a published lesson or
 * assignment in their class, their own submission, an announcement addressed
 * to them, a message in their class chat, or a file they uploaded.
 */
export async function canReadFileAsset(
  tenantId: string,
  asset: { id: string; uploadedByUserId: string },
  actor: JwtUser
): Promise<boolean> {
  if (asset.uploadedByUserId === actor.sub || isStaffReader(actor)) {
    return true;
  }

  const classRoomIds = await resolveViewerClassRoomIds(tenantId, actor);
  const inViewerClass = { tenantId, isActive: true, classRoomId: { in: classRoomIds } };

  const [lesson, assignment, submission, chatMessage] = await Promise.all([
    classRoomIds.length
      ? prisma.lesson.findFirst({
          where: { tenantId, fileAssetId: asset.id, isPublished: true, course: inViewerClass },
          select: { id: true },
        })
      : null,
    classRoomIds.length
      ? prisma.assignment.findFirst({
          where: {
            tenantId,
            attachmentAssetId: asset.id,
            isPublished: true,
            course: inViewerClass,
          },
          select: { id: true },
        })
      : null,
    prisma.submission.findFirst({
      where: { tenantId, fileAssetId: asset.id, studentUserId: actor.sub },
      select: { id: true },
    }),
    classRoomIds.length
      ? prisma.groupChatMessage.findFirst({
          where: {
            tenantId,
            fileAssetId: asset.id,
            deletedAt: null,
            chat: { classRoomId: { in: classRoomIds } },
          },
          select: { id: true },
        })
      : null,
  ]);

  if (lesson || assignment || submission || chatMessage) {
    return true;
  }

  const audienceConditions = await announcementsService.buildViewerAudienceConditions(
    tenantId,
    actor
  );
  const announcementAttachment = await prisma.announcementAttachment.findFirst({
    where: {
      tenantId,
      fileAssetId: asset.id,
      announcement: { tenantId, OR: audienceConditions },
    },
    select: { id: true },
  });

  return Boolean(announcementAttachment);
}

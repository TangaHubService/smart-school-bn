import { env } from '../../config/env';
import { prisma } from '../../db/prisma';

export async function grantCatalogTrialEnrollments(userId: string, catalogTenantId: string) {
  const hours = env.ACADEMY_TRIAL_HOURS;
  const expiresAt = new Date();
  expiresAt.setTime(expiresAt.getTime() + hours * 60 * 60 * 1000);

  const programs = await prisma.program.findMany({
    where: {
      tenantId: catalogTenantId,
      isActive: true,
      listedInPublicCatalog: true,
    },
    select: { id: true },
  });

  if (!programs.length) {
    return;
  }

  const programIds = programs.map((p) => p.id);
  const paidRows = await prisma.programEnrollment.findMany({
    where: {
      userId,
      programId: { in: programIds },
      isTrial: false,
    },
    select: { programId: true },
  });
  const paidProgramIds = new Set(paidRows.map((r) => r.programId));

  const ops = programs
    .filter((p) => !paidProgramIds.has(p.id))
    .map((p) =>
      prisma.programEnrollment.upsert({
        where: {
          userId_programId: {
            userId,
            programId: p.id,
          },
        },
        update: {
          tenantId: catalogTenantId,
          isActive: true,
          expiresAt,
          isTrial: true,
        },
        create: {
          tenantId: catalogTenantId,
          userId,
          programId: p.id,
          expiresAt,
          isActive: true,
          isTrial: true,
        },
      }),
    );

  if (ops.length) {
    await prisma.$transaction(ops);
  }
}

/**
 * Backfill LEARNER role (Revision #12 follow-up).
 *
 * For every tenant that has a PUBLIC_LEARNER role:
 *   1. Ensure a system LEARNER role exists with the same learner-scoped permissions.
 *   2. Grant LEARNER to every user holding PUBLIC_LEARNER who lacks it.
 *
 * Safe to re-run (uses upsert + existence checks). Never removes roles.
 */
import { prisma } from '../../src/db/prisma';

const LEARNER_PERMISSIONS = [
  'students.my_courses.read',
  'assignments.submit',
  'assessments.submit',
  'files.upload',
  'chat.read',
  'chat.send',
];

async function main() {
  const publicLearnerRoles = await prisma.role.findMany({
    where: { name: 'PUBLIC_LEARNER' },
    select: { id: true, tenantId: true },
  });
  console.log(`Found ${publicLearnerRoles.length} tenant(s) with PUBLIC_LEARNER`);

  let rolesCreated = 0;
  let grantsCreated = 0;

  for (const pl of publicLearnerRoles) {
    const learnerRole = await prisma.role.upsert({
      where: { tenantId_name: { tenantId: pl.tenantId, name: 'LEARNER' } },
      update: { permissions: LEARNER_PERMISSIONS },
      create: {
        tenantId: pl.tenantId,
        name: 'LEARNER',
        description: 'Academy learner role (Public Academy students)',
        isSystem: true,
        permissions: LEARNER_PERMISSIONS,
      },
    });
    // Detect whether the upsert created (heuristic: check UserRole coverage below instead).
    const holders = await prisma.userRole.findMany({
      where: { tenantId: pl.tenantId, roleId: pl.id },
      select: { userId: true },
    });
    const existing = await prisma.userRole.findMany({
      where: { tenantId: pl.tenantId, roleId: learnerRole.id },
      select: { userId: true },
    });
    const existingSet = new Set(existing.map((e: { userId: string }) => e.userId));
    const missing = holders.filter((h: { userId: string }) => !existingSet.has(h.userId));
    if (missing.length) {
      await prisma.userRole.createMany({
        data: missing.map(h => ({
          tenantId: pl.tenantId,
          userId: h.userId,
          roleId: learnerRole.id,
        })),
        skipDuplicates: true,
      });
      grantsCreated += missing.length;
    }
    void rolesCreated;
    console.log(
      `tenant ${pl.tenantId}: ensured LEARNER role, granted to ${missing.length} user(s)`
    );
  }

  // Also cover tenants that inlined learner permissions without a PUBLIC_LEARNER role:
  // nothing to do — LEARNER is created on academy registration going forward.

  console.log(`Done. grants created: ${grantsCreated}`);
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Checking for duplicate registration numbers in School model...\n');

  const duplicateSchools = await prisma.school.groupBy({
    by: ['registrationNumber'],
    where: {
      registrationNumber: { not: null },
    },
    _count: true,
    having: {
      registrationNumber: { _count: { gt: 1 } },
    },
  });

  if (duplicateSchools.length === 0) {
    console.log('✅ No duplicate registration numbers found.');
    console.log('   All schools have unique registration numbers.');
  } else {
    console.log('❌ DUPLICATES FOUND:\n');
    for (const dup of duplicateSchools) {
      const schools = await prisma.school.findMany({
        where: { registrationNumber: dup.registrationNumber },
        select: {
          id: true,
          tenantId: true,
          displayName: true,
          registrationNumber: true,
        },
      });
      console.log(`  Registration Number: "${dup.registrationNumber}"`);
      console.log(`  Occurrences: ${dup._count}`);
      for (const school of schools) {
        console.log(
          `    - ID: ${school.id}, Tenant: ${school.tenantId}, Name: ${school.displayName}`
        );
      }
      console.log();
    }
    console.log('Action Required: Resolve duplicates before running seed in production.');
  }

  const schoolsWithNullRegistration = await prisma.school.count({
    where: { registrationNumber: null },
  });
  if (schoolsWithNullRegistration > 0) {
    console.log(`ℹ️  Note: ${schoolsWithNullRegistration} school(s) have NULL registrationNumber (allowed).`);
  }
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
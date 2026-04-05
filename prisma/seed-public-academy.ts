import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  console.log('Seed: Initializing Public Academy...');

  const academyTenant = await prisma.tenant.upsert({
    where: { code: 'PUBLIC_ACADEMY' },
    update: {
      name: 'Smart School Public Academy',
    },
    create: {
      code: 'PUBLIC_ACADEMY',
      name: 'Smart School Public Academy',
      domain: 'academy.smartschool.rw',
    },
  });

  await prisma.tenant.updateMany({
    where: { id: { not: academyTenant.id }, isAcademyCatalog: true },
    data: { isAcademyCatalog: false },
  });
  await prisma.tenant.update({
    where: { id: academyTenant.id },
    data: { isAcademyCatalog: true },
  });

  console.log(`Created/Updated Tenant: ${academyTenant.name} (${academyTenant.id}) — academy catalog`);

  // Create PUBLIC_LEARNER role
  const publicLearnerRole = await prisma.role.upsert({
    where: {
      tenantId_name: {
        tenantId: academyTenant.id,
        name: 'PUBLIC_LEARNER',
      },
    },
    update: {
      permissions: [
        'students.my_courses.read',
        'assessments.submit',
        'files.upload',
      ],
    },
    create: {
      tenantId: academyTenant.id,
      name: 'PUBLIC_LEARNER',
      description: 'Public Academy learner role',
      isSystem: true,
      permissions: [
        'students.my_courses.read',
        'assessments.submit',
        'files.upload',
      ],
    },
  });

  console.log(`Created/Updated Role: ${publicLearnerRole.name}`);

  await prisma.school.upsert({
    where: { tenantId: academyTenant.id },
    update: { displayName: 'Smart School Public Academy' },
    create: {
      tenantId: academyTenant.id,
      displayName: 'Smart School Public Academy',
    },
  });

  const academyGrade = await prisma.gradeLevel.upsert({
    where: {
      tenantId_code: { tenantId: academyTenant.id, code: 'ACAD-GEN' },
    },
    update: {},
    create: {
      tenantId: academyTenant.id,
      code: 'ACAD-GEN',
      name: 'General',
      rank: 1,
    },
  });

  const academyYear = await prisma.academicYear.upsert({
    where: {
      tenantId_name: { tenantId: academyTenant.id, name: 'Catalog 2026' },
    },
    update: { isCurrent: true, isActive: true },
    create: {
      tenantId: academyTenant.id,
      name: 'Catalog 2026',
      startDate: new Date('2026-01-01'),
      endDate: new Date('2026-12-31'),
      isCurrent: true,
      isActive: true,
    },
  });

  const academyClass = await prisma.classRoom.upsert({
    where: {
      tenantId_code: { tenantId: academyTenant.id, code: 'ACAD-CAT' },
    },
    update: {},
    create: {
      tenantId: academyTenant.id,
      gradeLevelId: academyGrade.id,
      code: 'ACAD-CAT',
      name: 'Catalog',
    },
  });

  const catalogAuthorHash = await require('bcrypt').hash('Password123!', 12);
  const catalogAuthor = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: academyTenant.id,
        email: 'academy.catalog.author@academy.rw',
      },
    },
    update: { passwordHash: catalogAuthorHash },
    create: {
      tenantId: academyTenant.id,
      email: 'academy.catalog.author@academy.rw',
      firstName: 'Catalog',
      lastName: 'Author',
      passwordHash: catalogAuthorHash,
      status: 'ACTIVE',
    },
  });

  const testCourseContent = await prisma.course.upsert({
    where: {
      tenantId_academicYearId_classRoomId_teacherUserId_title: {
        tenantId: academyTenant.id,
        academicYearId: academyYear.id,
        classRoomId: academyClass.id,
        teacherUserId: catalogAuthor.id,
        title: 'Test course (100 RWF) — content',
      },
    },
    update: { isActive: true },
    create: {
      tenantId: academyTenant.id,
      academicYearId: academyYear.id,
      classRoomId: academyClass.id,
      teacherUserId: catalogAuthor.id,
      title: 'Test course (100 RWF) — content',
      description: 'Seeded LMS course for the 100 RWF academy program',
      isActive: true,
    },
  });

  await prisma.lesson.upsert({
    where: {
      tenantId_courseId_sequence: {
        tenantId: academyTenant.id,
        courseId: testCourseContent.id,
        sequence: 1,
      },
    },
    update: {
      title: 'Welcome',
      contentType: 'TEXT',
      body: 'This is a test lesson for the Test course (100 RWF) program.',
      isPublished: true,
      publishedAt: new Date(),
      publishedByUserId: catalogAuthor.id,
    },
    create: {
      tenantId: academyTenant.id,
      courseId: testCourseContent.id,
      title: 'Welcome',
      contentType: 'TEXT',
      body: 'This is a test lesson for the Test course (100 RWF) program.',
      sequence: 1,
      isPublished: true,
      publishedAt: new Date(),
      createdByUserId: catalogAuthor.id,
      publishedByUserId: catalogAuthor.id,
    },
  });

  await prisma.program.upsert({
    where: {
      tenantId_title: {
        tenantId: academyTenant.id,
        title: 'Test course (100 RWF)',
      },
    },
    update: {
      description: 'Cheap test listing (100 RWF) with linked course content.',
      price: 100,
      durationDays: 30,
      courseId: testCourseContent.id,
      listedInPublicCatalog: true,
      isActive: true,
    },
    create: {
      tenantId: academyTenant.id,
      title: 'Test course (100 RWF)',
      description: 'Cheap test listing (100 RWF) with linked course content.',
      price: 100,
      durationDays: 30,
      courseId: testCourseContent.id,
      listedInPublicCatalog: true,
      isActive: true,
    },
  });

  console.log('Seeded academy test program: Test course (100 RWF) + course + lesson');

  // Create initial programs
  const programs = [
    {
      title: 'Web Development Bootcamp',
      description: 'Learn full-stack web development from scratch.',
      thumbnail: 'https://res.cloudinary.com/dv8svgy01/image/upload/v1741600000/smart-school/web-dev.jpg',
      price: 50000,
      durationDays: 90,
    },
    {
      title: 'Digital Marketing Essentials',
      description: 'Master the basics of SEO, SEM, and social media marketing.',
      thumbnail: 'https://res.cloudinary.com/dv8svgy01/image/upload/v1741600000/smart-school/marketing.jpg',
      price: 25000,
      durationDays: 30,
    },
    {
      title: 'Mobile App Development with React Native',
      description: 'Build cross-platform mobile apps for iOS and Android.',
      thumbnail: 'https://res.cloudinary.com/dv8svgy01/image/upload/v1741600000/smart-school/mobile-dev.jpg',
      price: 45000,
      durationDays: 60,
    },
  ];

  for (const prog of programs) {
    await prisma.program.upsert({
      where: {
        tenantId_title: {
          tenantId: academyTenant.id,
          title: prog.title,
        },
      },
      update: {
        description: prog.description,
        thumbnail: prog.thumbnail,
        price: prog.price,
        durationDays: prog.durationDays,
      },
      create: {
        tenantId: academyTenant.id,
        ...prog,
      },
    });
  }

  // Create demo learner
  const learnerEmail = 'learner@academy.rw';
  const hashedPassword = await require('bcrypt').hash('Password123!', 12);

  const demoLearner = await prisma.user.upsert({
    where: {
      tenantId_email: {
        tenantId: academyTenant.id,
        email: learnerEmail,
      },
    },
    update: {
      passwordHash: hashedPassword,
    },
    create: {
      tenantId: academyTenant.id,
      email: learnerEmail,
      firstName: 'Demo',
      lastName: 'Learner',
      passwordHash: hashedPassword,
      status: 'ACTIVE',
    },
  });

  // Create student record for the demo learner
  await prisma.student.upsert({
    where: {
      userId: demoLearner.id,
    },
    update: {
      studentCode: 'L-DEMO',
      firstName: 'Demo',
      lastName: 'Learner',
      isActive: true,
    },
    create: {
      tenantId: academyTenant.id,
      userId: demoLearner.id,
      studentCode: 'L-DEMO',
      firstName: 'Demo',
      lastName: 'Learner',
      isActive: true,
    },
  });

  await prisma.userRole.upsert({
    where: {
      tenantId_userId_roleId: {
        tenantId: academyTenant.id,
        userId: demoLearner.id,
        roleId: publicLearnerRole.id,
      },
    },
    update: {},
    create: {
      tenantId: academyTenant.id,
      userId: demoLearner.id,
      roleId: publicLearnerRole.id,
    },
  });

  console.log(`Created/Updated Demo Learner: ${learnerEmail}`);

  console.log('Seed: Public Academy initialization complete.');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

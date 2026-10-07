import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const GRADES = [
  { code: 'P1', name: 'Primary 1', rank: 1 },
  { code: 'P2', name: 'Primary 2', rank: 2 },
  { code: 'P3', name: 'Primary 3', rank: 3 },
  { code: 'P4', name: 'Primary 4', rank: 4 },
  { code: 'P5', name: 'Primary 5', rank: 5 },
  { code: 'P6', name: 'Primary 6', rank: 6 },
];

const SUBJECTS = [
  { code: 'MATH', name: 'Mathematics', isCore: true },
  { code: 'ENG', name: 'English', isCore: true },
  { code: 'KIN', name: 'Kinyarwanda', isCore: true },
  { code: 'SET', name: 'Science and Elementary Technology', isCore: true },
  { code: 'SST', name: 'Social and Religious Studies', isCore: false },
];

interface LessonSeed {
  title: string;
  summary: string;
  body: string;
}

const LESSONS_BY_SUBJECT: Record<string, LessonSeed[]> = {
  MATH: [
    {
      title: 'Unit 1: Counting and number patterns',
      summary: 'Read, write, and order whole numbers.',
      body: '<p><strong>Key competence:</strong> count, read, write, and order whole numbers in daily situations.</p><p>Activities: count objects in the classroom, arrange number cards from smallest to largest, and complete the missing numbers in each pattern.</p>',
    },
    {
      title: 'Unit 2: Addition and subtraction',
      summary: 'Add and subtract with and without regrouping.',
      body: '<p><strong>Key competence:</strong> add and subtract numbers and solve simple word problems.</p><p>Activities: use bottle tops to model additions, solve the market word problems, and check each answer by doing the inverse operation.</p>',
    },
    {
      title: 'Unit 3: Multiplication tables',
      summary: 'Build and use multiplication tables up to 10.',
      body: '<p><strong>Key competence:</strong> multiply numbers and apply multiplication in sharing problems.</p><p>Activities: recite the tables in groups, fill the multiplication grid, and solve sharing problems with leftovers.</p>',
    },
    {
      title: 'Unit 4: Shapes and measurements',
      summary: 'Name shapes and measure length, mass, and capacity.',
      body: '<p><strong>Key competence:</strong> identify 2D and 3D shapes and take simple measurements.</p><p>Activities: sort classroom objects by shape, measure desk lengths with a ruler, and compare masses using a balance.</p>',
    },
  ],
  ENG: [
    {
      title: 'Unit 1: Greetings and introductions',
      summary: 'Greet people and introduce yourself politely.',
      body: '<p><strong>Key competence:</strong> greet others and introduce yourself in simple English.</p><p>Activities: practise morning and afternoon greetings in pairs, role-play meeting a new friend, and sing the greeting song.</p>',
    },
    {
      title: 'Unit 2: Alphabet and phonics',
      summary: 'Sound out letters and read simple syllables.',
      body: '<p><strong>Key competence:</strong> recognise letter sounds and blend them into syllables.</p><p>Activities: point to letters called by the teacher, clap the syllables of your name, and match pictures to beginning sounds.</p>',
    },
    {
      title: 'Unit 3: Simple sentences',
      summary: 'Build short sentences about daily life.',
      body: '<p><strong>Key competence:</strong> speak and write short correct sentences.</p><p>Activities: describe what you see in the picture, rearrange word cards into sentences, and tell the class one thing you did today.</p>',
    },
    {
      title: 'Unit 4: Reading a short story',
      summary: 'Read and answer questions about a short story.',
      body: '<p><strong>Key competence:</strong> read a short story with understanding.</p><p>Activities: read the story aloud in turns, answer who/what/where questions, and draw your favourite scene from the story.</p>',
    },
  ],
  KIN: [
    {
      title: 'Unit 1: Inyuguti n\'amajwi',
      summary: 'Kumenya inyuguti n\'amajwi yazo.',
      body: '<p><strong>Ubushobozi bw\'ingenzi:</strong> umunyeshuri avuga neza amajwi y\'inyuguti kandi akayandika.</p><p>Ibikorwa: kwerekana inyuguti umwarimu avuze, guhuza amafoto n\'ijwi rya mbere, no kuririmba indirimbo y\'inyuguti.</p>',
    },
    {
      title: 'Unit 2: Kuvuga no kumva',
      summary: 'Kuramutsa no kwimenyekanisha mu Kinyarwanda.',
      body: '<p><strong>Ubushobozi bw\'ingenzi:</strong> umunyeshuri aramutsa neza kandi akivuga mu magambo yoroshye.</p><p>Ibikorwa: gukina ikinamico cyo kuramutsa umushyitsi, kuvuga izina ryawe n\'aho utuye, no gusubiramo interuro umwarimu avuze.</p>',
    },
    {
      title: 'Unit 3: Gusoma inkuru ngufi',
      summary: 'Gusoma inkuru no kuyisobanukirwa.',
      body: '<p><strong>Ubushobozi bw\'ingenzi:</strong> umunyeshuri asoma inkuru ngufi akayisobanukirwa.</p><p>Ibikorwa: gusoma inkuru mu gusimburana, gusubiza ibibazo kuri nde/iki/hehe, no gushushanya igice cy\'inkuru wakunze.</p>',
    },
    {
      title: 'Unit 4: Kwandika interuro zoroshye',
      summary: 'Kwandika interuro ngufi zuzuye.',
      body: '<p><strong>Ubushobozi bw\'ingenzi:</strong> umunyeshuri yandika interuro ngufi zuzuye kandi zinoze.</p><p>Ibikorwa: gutondekanya amagambo mu nteruro, kwandika interuro ku byo ubona ku ifoto, no kwandika interuro ebyiri ku munsi wawe.</p>',
    },
  ],
  SET: [
    {
      title: 'Unit 1: Living things around us',
      summary: 'Group plants and animals found at home and school.',
      body: '<p><strong>Key competence:</strong> identify living things and state what they need to live.</p><p>Activities: walk around the school compound naming plants and animals, sort picture cards into plants and animals, and list what a bean plant needs to grow.</p>',
    },
    {
      title: 'Unit 2: Water and its uses',
      summary: 'State sources and uses of clean water.',
      body: '<p><strong>Key competence:</strong> explain where clean water comes from and how to keep it safe.</p><p>Activities: name water sources in your village, demonstrate hand washing steps, and show how to cover stored drinking water.</p>',
    },
    {
      title: 'Unit 3: Weather and seasons',
      summary: 'Observe sunshine, clouds, wind, and rain.',
      body: '<p><strong>Key competence:</strong> describe daily weather and dress accordingly.</p><p>Activities: record morning and afternoon weather for a week, draw weather symbols, and match clothes to sunny and rainy days.</p>',
    },
    {
      title: 'Unit 4: Keeping our environment clean',
      summary: 'Practise hygiene and a clean classroom habits.',
      body: '<p><strong>Key competence:</strong> keep the home, classroom, and compound clean.</p><p>Activities: sort waste into bins, sweep and arrange the classroom, and plant one tree seedling at school.</p>',
    },
  ],
};

const COURSES_PER_CLASS = ['MATH', 'ENG', 'KIN', 'SET'];

async function main() {
  console.log('Seed: Primary programs, courses, and lessons...');

  let catalogTenant = await prisma.tenant.findFirst({ where: { isAcademyCatalog: true } });

  if (!catalogTenant) {
    const byCode = await prisma.tenant.findUnique({ where: { code: 'PUBLIC_ACADEMY' } });
    if (byCode) {
      catalogTenant = await prisma.tenant.update({
        where: { id: byCode.id },
        data: { isAcademyCatalog: true, isActive: true },
      });
      console.log(`Promoted tenant ${byCode.code} to academy catalog.`);
    } else {
      catalogTenant = await prisma.tenant.create({
        data: {
          code: 'PUBLIC_ACADEMY',
          name: 'Smart School Public Academy',
          domain: 'academy.smartschool.rw',
          isAcademyCatalog: true,
          isActive: true,
        },
      });
      console.log('Created academy catalog tenant PUBLIC_ACADEMY.');
    }
    await prisma.tenant.updateMany({
      where: { id: { not: catalogTenant.id }, isAcademyCatalog: true },
      data: { isAcademyCatalog: false },
    });
  }

  await prisma.school.upsert({
    where: { tenantId: catalogTenant.id },
    update: { displayName: 'Smart School Public Academy' },
    create: { tenantId: catalogTenant.id, displayName: 'Smart School Public Academy' },
  });

  await prisma.role.upsert({
    where: { tenantId_name: { tenantId: catalogTenant.id, name: 'PUBLIC_LEARNER' } },
    update: {
      permissions: [
        'students.my_courses.read',
        'assessments.submit',
        'files.upload',
        'chat.read',
        'chat.send',
      ],
    },
    create: {
      tenantId: catalogTenant.id,
      name: 'PUBLIC_LEARNER',
      description: 'Public programs learner role',
      isSystem: true,
      permissions: [
        'students.my_courses.read',
        'assessments.submit',
        'files.upload',
        'chat.read',
        'chat.send',
      ],
    },
  });

  const existingPrimary = await prisma.program.count({
    where: {
      tenantId: catalogTenant.id,
      isActive: true,
      listedInPublicCatalog: true,
      title: { startsWith: 'Primary ' },
    },
  });

  if (existingPrimary >= GRADES.length) {
    console.log(
      `Skipped: ${existingPrimary} primary programs already listed — nothing to seed.`
    );
    return;
  }

  const academicYear =
    (await prisma.academicYear.findFirst({
      where: { tenantId: catalogTenant.id, isCurrent: true, isActive: true },
    })) ??
    (await prisma.academicYear.upsert({
      where: { tenantId_name: { tenantId: catalogTenant.id, name: '2026' } },
      update: { isCurrent: true, isActive: true },
      create: {
        tenantId: catalogTenant.id,
        name: '2026',
        startDate: new Date('2026-01-01'),
        endDate: new Date('2026-12-31'),
        isCurrent: true,
        isActive: true,
      },
    }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const bcrypt = require('bcrypt');
  const authorHash = await bcrypt.hash('Password123!', 12);
  const author =
    (await prisma.user.findFirst({
      where: { tenantId: catalogTenant.id, email: 'primary.content.author@academy.rw' },
    })) ??
    (await prisma.user.create({
      data: {
        tenantId: catalogTenant.id,
        email: 'primary.content.author@academy.rw',
        firstName: 'Primary',
        lastName: 'Author',
        passwordHash: authorHash,
        status: 'ACTIVE',
      },
    }));

  const subjectByCode = new Map<string, { id: string; name: string }>();
  for (const subject of SUBJECTS) {
    const row = await prisma.subject.upsert({
      where: { tenantId_code: { tenantId: catalogTenant.id, code: subject.code } },
      update: { name: subject.name, isCore: subject.isCore, isActive: true },
      create: {
        tenantId: catalogTenant.id,
        code: subject.code,
        name: subject.name,
        isCore: subject.isCore,
        isActive: true,
      },
    });
    subjectByCode.set(subject.code, { id: row.id, name: row.name });
  }

  let courseCount = 0;
  let lessonCount = 0;

  for (const grade of GRADES) {
    const gradeLevel = await prisma.gradeLevel.upsert({
      where: { tenantId_code: { tenantId: catalogTenant.id, code: grade.code } },
      update: { name: grade.name, rank: grade.rank, isActive: true },
      create: {
        tenantId: catalogTenant.id,
        code: grade.code,
        name: grade.name,
        rank: grade.rank,
        isActive: true,
      },
    });

    const classRoom = await prisma.classRoom.upsert({
      where: { tenantId_code: { tenantId: catalogTenant.id, code: `PRI-${grade.rank}` } },
      update: { name: grade.name, gradeLevelId: gradeLevel.id, isActive: true },
      create: {
        tenantId: catalogTenant.id,
        gradeLevelId: gradeLevel.id,
        code: `PRI-${grade.rank}`,
        name: grade.name,
        capacity: 60,
        isActive: true,
      },
    });

    for (const subjectCode of COURSES_PER_CLASS) {
      const subject = subjectByCode.get(subjectCode)!;
      const title = `${grade.name} ${subject.name}`;
      const course = await prisma.course.upsert({
        where: {
          tenantId_academicYearId_classRoomId_teacherUserId_title: {
            tenantId: catalogTenant.id,
            academicYearId: academicYear.id,
            classRoomId: classRoom.id,
            teacherUserId: author.id,
            title,
          },
        },
        update: { description: courseDescription(grade.name, subject.name), isActive: true },
        create: {
          tenantId: catalogTenant.id,
          academicYearId: academicYear.id,
          classRoomId: classRoom.id,
          subjectId: subject.id,
          teacherUserId: author.id,
          title,
          description: courseDescription(grade.name, subject.name),
          isActive: true,
        },
      });
      courseCount += 1;

      const lessons = LESSONS_BY_SUBJECT[subjectCode];
      for (let index = 0; index < lessons.length; index += 1) {
        const lesson = lessons[index];
        await prisma.lesson.upsert({
          where: {
            tenantId_courseId_sequence: {
              tenantId: catalogTenant.id,
              courseId: course.id,
              sequence: index + 1,
            },
          },
          update: {
            title: lesson.title,
            summary: lesson.summary,
            contentType: 'TEXT',
            body: lesson.body,
            isPublished: true,
            publishedAt: new Date(),
            publishedByUserId: author.id,
          },
          create: {
            tenantId: catalogTenant.id,
            courseId: course.id,
            title: lesson.title,
            summary: lesson.summary,
            contentType: 'TEXT',
            body: lesson.body,
            sequence: index + 1,
            isPublished: true,
            publishedAt: new Date(),
            createdByUserId: author.id,
            publishedByUserId: author.id,
          },
        });
        lessonCount += 1;
      }
    }

    await prisma.program.upsert({
      where: { tenantId_title: { tenantId: catalogTenant.id, title: `${grade.name} Complete Program` } },
      update: {
        description: `${grade.name} full program: enroll in this class and unlock Mathematics, English, Kinyarwanda, and Science lessons with revision.`,
        price: 5000,
        durationDays: 90,
        classRoomId: classRoom.id,
        listedInPublicCatalog: true,
        isActive: true,
      },
      create: {
        tenantId: catalogTenant.id,
        title: `${grade.name} Complete Program`,
        description: `${grade.name} full program: enroll in this class and unlock Mathematics, English, Kinyarwanda, and Science lessons with revision.`,
        price: 5000,
        durationDays: 90,
        classRoomId: classRoom.id,
        listedInPublicCatalog: true,
        isActive: true,
      },
    });
  }

  console.log(
    `Seeded ${GRADES.length} primary programs, ${courseCount} courses, ${lessonCount} lessons on catalog tenant ${catalogTenant.code}.`
  );
}

function courseDescription(gradeName: string, subjectName: string) {
  return `${subjectName} course for ${gradeName}: sequenced lessons, activities, and revision for the school year.`;
}

main()
  .catch(e => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

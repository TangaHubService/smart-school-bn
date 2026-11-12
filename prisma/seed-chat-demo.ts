/**
 * Demo data for student chat (class chat, a study group and a direct message).
 *
 *   npm run prisma:seed:chat-demo
 *
 * Creates three students who can log in, all in the same class of the school given by
 * CHAT_DEMO_TENANT_CODE (default: nyange-ss), plus a few conversations between them.
 * Safe to run again: accounts are upserted and messages are only added to empty chats.
 *
 * Also adds a parent of Aline and a published announcement, to try parent announcements
 * (acknowledge / reply).
 *
 * Logins (local/test data only):
 *   demo_aline  / Student@12345
 *   demo_brian  / Student@12345
 *   demo_claire / Student@12345
 *   demo_parent / Parent@12345   (parent of Aline)
 */
import bcrypt from 'bcrypt';
import { ChatMemberRole, ChatType, PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const TENANT_CODE = process.env.CHAT_DEMO_TENANT_CODE ?? 'nyange-ss';
const PASSWORD = 'Student@12345';
const PARENT_PASSWORD = 'Parent@12345';

const STUDENTS = [
  { username: 'demo_aline', email: 'aline.demo@chat.local', firstName: 'Aline', lastName: 'Mukamana', code: 'CHAT-DEMO-01', gender: 'FEMALE' as const },
  { username: 'demo_brian', email: 'brian.demo@chat.local', firstName: 'Brian', lastName: 'Habimana', code: 'CHAT-DEMO-02', gender: 'MALE' as const },
  { username: 'demo_claire', email: 'claire.demo@chat.local', firstName: 'Claire', lastName: 'Uwimana', code: 'CHAT-DEMO-03', gender: 'FEMALE' as const },
];

async function main() {
  const tenant = await prisma.tenant.findUnique({ where: { code: TENANT_CODE }, select: { id: true, code: true } });
  if (!tenant) throw new Error(`School "${TENANT_CODE}" not found. Run the main seed first or set CHAT_DEMO_TENANT_CODE.`);
  const tenantId = tenant.id;

  const studentRole = await prisma.role.findFirst({ where: { tenantId, name: 'STUDENT' } });
  if (!studentRole) throw new Error(`School "${TENANT_CODE}" has no STUDENT role.`);
  const perms = (studentRole.permissions as string[] | null) ?? [];
  if (!perms.includes('chat.read') || !perms.includes('chat.send')) {
    console.warn(`⚠ The STUDENT role in ${TENANT_CODE} lacks chat.read/chat.send — students will not see Chat.`);
  }

  const year =
    (await prisma.academicYear.findFirst({ where: { tenantId, isCurrent: true, isActive: true }, orderBy: { startDate: 'desc' } })) ??
    (await prisma.academicYear.findFirst({ where: { tenantId, isActive: true }, orderBy: { startDate: 'desc' } }));
  if (!year) throw new Error(`School "${TENANT_CODE}" has no active academic year.`);

  // Prefer the class existing students are in, so the demo joins a real class chat.
  const existingEnrollment = await prisma.studentEnrollment.findFirst({
    where: { tenantId, academicYearId: year.id, isActive: true },
    select: { classRoomId: true },
  });
  const classRoom = existingEnrollment
    ? await prisma.classRoom.findUnique({ where: { id: existingEnrollment.classRoomId } })
    : await prisma.classRoom.findFirst({ where: { tenantId, isActive: true }, orderBy: { name: 'asc' } });
  if (!classRoom) throw new Error(`School "${TENANT_CODE}" has no active class.`);

  const passwordHash = await bcrypt.hash(PASSWORD, 12);
  const users: Array<{ id: string; firstName: string }> = [];

  for (const s of STUDENTS) {
    const user = await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: s.email } },
      update: { passwordHash, username: s.username, status: 'ACTIVE', deletedAt: null },
      create: { tenantId, email: s.email, username: s.username, passwordHash, firstName: s.firstName, lastName: s.lastName },
    });
    await prisma.userRole.upsert({
      where: { tenantId_userId_roleId: { tenantId, userId: user.id, roleId: studentRole.id } },
      update: {},
      create: { tenantId, userId: user.id, roleId: studentRole.id },
    });
    const student = await prisma.student.upsert({
      where: { tenantId_studentCode: { tenantId, studentCode: s.code } },
      update: { userId: user.id, isActive: true, deletedAt: null },
      create: { tenantId, studentCode: s.code, firstName: s.firstName, lastName: s.lastName, gender: s.gender, userId: user.id },
    });
    const enrollment = await prisma.studentEnrollment.findFirst({
      where: { tenantId, studentId: student.id, academicYearId: year.id, isActive: true },
    });
    if (!enrollment) {
      await prisma.studentEnrollment.create({
        data: { tenantId, studentId: student.id, academicYearId: year.id, classRoomId: classRoom.id },
      });
    }
    users.push({ id: user.id, firstName: s.firstName });
  }
  const [aline, brian, claire] = users;

  async function addMessagesIfEmpty(chatId: string, lines: Array<[{ id: string }, string]>) {
    if ((await prisma.groupChatMessage.count({ where: { chatId } })) > 0) return 0;
    const start = Date.now() - lines.length * 4 * 60 * 1000;
    for (const [index, [sender, content]] of lines.entries()) {
      await prisma.groupChatMessage.create({
        data: { tenantId, chatId, senderId: sender.id, content, createdAt: new Date(start + index * 4 * 60 * 1000) },
      });
    }
    await prisma.studentGroupChat.update({ where: { id: chatId }, data: { lastMessageAt: new Date() } });
    return lines.length;
  }

  // 1. Class chat
  const classChat = await prisma.studentGroupChat.upsert({
    where: { tenantId_classRoomId_academicYearId: { tenantId, classRoomId: classRoom.id, academicYearId: year.id } },
    update: {},
    create: { tenantId, type: ChatType.CLASS, classRoomId: classRoom.id, academicYearId: year.id, title: 'Class Chat' },
  });
  const classCount = await addMessagesIfEmpty(classChat.id, [
    [aline, 'Good morning everyone 👋'],
    [brian, 'Morning! Did anyone finish the maths homework?'],
    [claire, 'Almost, question 4 is hard 😅'],
    [aline, 'We can go through it together after class'],
  ]);

  // 2. Study group
  const groupTitle = 'Maths study group';
  let group = await prisma.studentGroupChat.findFirst({
    where: { tenantId, type: ChatType.GROUP, title: groupTitle, createdByUserId: aline.id },
  });
  if (!group) {
    group = await prisma.studentGroupChat.create({
      data: {
        tenantId,
        type: ChatType.GROUP,
        title: groupTitle,
        description: 'Revision for the end-of-term exam',
        createdByUserId: aline.id,
        members: {
          create: [
            { tenantId, userId: aline.id, role: ChatMemberRole.ADMIN },
            { tenantId, userId: brian.id, role: ChatMemberRole.MEMBER },
            { tenantId, userId: claire.id, role: ChatMemberRole.MEMBER },
          ],
        },
      },
    });
  }
  const groupCount = await addMessagesIfEmpty(group.id, [
    [aline, 'Welcome to our study group! Let us revise fractions first.'],
    [claire, 'Great idea. Can someone explain how to add 1/3 + 1/4?'],
    [brian, 'Find a common denominator: 12. So 4/12 + 3/12 = 7/12 ✅'],
    [claire, 'Thank you Brian 🙏'],
  ]);

  // 3. Direct message (Aline ↔ Brian)
  const [a, b] = [aline.id, brian.id].sort();
  const directKey = `${tenantId}:${a}:${b}`;
  const dm =
    (await prisma.studentGroupChat.findUnique({ where: { directKey } })) ??
    (await prisma.studentGroupChat.create({
      data: {
        tenantId,
        type: ChatType.DIRECT,
        title: 'Direct message',
        directKey,
        createdByUserId: aline.id,
        members: { create: [{ tenantId, userId: a }, { tenantId, userId: b }] },
      },
    }));
  const dmCount = await addMessagesIfEmpty(dm.id, [
    [brian, 'Hi Aline, can I borrow your biology notes?'],
    [aline, 'Sure! I will bring them tomorrow 📚'],
  ]);

  // 4. Parent of Aline + an announcement for parents
  const parentRole = await prisma.role.findFirst({ where: { tenantId, name: 'PARENT' } });
  if (parentRole) {
    const parentUser = await prisma.user.upsert({
      where: { tenantId_email: { tenantId, email: 'parent.demo@chat.local' } },
      update: { passwordHash: await bcrypt.hash(PARENT_PASSWORD, 12), username: 'demo_parent', status: 'ACTIVE', deletedAt: null },
      create: {
        tenantId,
        email: 'parent.demo@chat.local',
        username: 'demo_parent',
        passwordHash: await bcrypt.hash(PARENT_PASSWORD, 12),
        firstName: 'Jeanne',
        lastName: 'Mukamana',
      },
    });
    await prisma.userRole.upsert({
      where: { tenantId_userId_roleId: { tenantId, userId: parentUser.id, roleId: parentRole.id } },
      update: {},
      create: { tenantId, userId: parentUser.id, roleId: parentRole.id },
    });
    const parent = await prisma.parent.upsert({
      where: { tenantId_email: { tenantId, email: 'parent.demo@chat.local' } },
      update: { userId: parentUser.id, isActive: true, deletedAt: null },
      create: { tenantId, email: 'parent.demo@chat.local', firstName: 'Jeanne', lastName: 'Mukamana', parentCode: 'PAR-DEMO-01', userId: parentUser.id },
    });
    const alineStudent = await prisma.student.findUniqueOrThrow({
      where: { tenantId_studentCode: { tenantId, studentCode: STUDENTS[0].code } },
      select: { id: true },
    });
    await prisma.parentStudent.upsert({
      where: { tenantId_parentId_studentId: { tenantId, parentId: parent.id, studentId: alineStudent.id } },
      update: {},
      create: { tenantId, parentId: parent.id, studentId: alineStudent.id, relationship: 'MOTHER', isPrimary: true },
    });

    const author = await prisma.user.findFirst({
      where: { tenantId, deletedAt: null, userRoles: { some: { role: { name: { in: ['SCHOOL_ADMIN', 'TEACHER'] } } } } },
      select: { id: true },
    });
    const title = 'Parents meeting on Friday';
    if (author && !(await prisma.announcement.findFirst({ where: { tenantId, title } }))) {
      await prisma.announcement.create({
        data: {
          tenantId,
          title,
          body: 'Dear parents, we invite you to a meeting this Friday at 2pm in the school hall to discuss end-of-term results. Please acknowledge, or reply if you cannot attend.',
          authorUserId: author.id,
          audience: 'SPECIFIC_ROLES',
          targetRoleNames: ['PARENT'],
          priority: 'HIGH',
          publishedAt: new Date(),
        },
      });
    }
  } else {
    console.warn(`⚠ No PARENT role in ${TENANT_CODE}; skipped the demo parent.`);
  }

  console.log(`✔ Chat demo ready in ${tenant.code}, class "${classRoom.name}" (${year.name}).`);
  console.log(`  Messages added — class: ${classCount}, group: ${groupCount}, direct: ${dmCount} (0 = already seeded).`);
  console.log(`  Log in as demo_aline, demo_brian or demo_claire with password ${PASSWORD}.`);
  console.log(`  Parent: demo_parent / ${PARENT_PASSWORD} (parent of Aline).`);
}

main()
  .catch(err => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

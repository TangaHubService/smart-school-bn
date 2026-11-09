import request from 'supertest';

import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';
import { accessTokenFor, createSchool, resetDatabase, TestUser } from './fixtures';

/**
 * GET /files/:id/view must work for the people a file was shared with
 * (students and parents of that class) and nobody else.
 */
describe('file access (real database)', () => {
  const app = createApp();
  let alpha: Awaited<ReturnType<typeof createSchool>>;
  let beta: Awaited<ReturnType<typeof createSchool>>;
  let teacher: TestUser;
  let classAFileId: string;
  let classBFileId: string;
  let betaFileId: string;
  let studentA: TestUser;
  let studentB: TestUser;
  let parentOfA: TestUser;

  const view = (fileId: string, user: TestUser) =>
    request(app)
      .get(`/files/${fileId}/view`)
      .set('Authorization', `Bearer ${accessTokenFor(user)}`);

  beforeAll(async () => {
    await resetDatabase();
    alpha = await createSchool('Alpha');
    beta = await createSchool('Beta');
    teacher = await alpha.createUser('TEACHER', { password: 'Teacher-pass-1' });
    classAFileId = (await alpha.createLessonFile(alpha.classA.id, teacher)).id;
    classBFileId = (await alpha.createLessonFile(alpha.classB.id, teacher)).id;
    const betaTeacher = await beta.createUser('TEACHER', { password: 'Teacher-pass-1' });
    betaFileId = (await beta.createLessonFile(beta.classA.id, betaTeacher)).id;

    const enrolledA = await alpha.createStudent('A-STUDENT', alpha.classA.id);
    studentA = enrolledA.user;
    studentB = (await alpha.createStudent('B-STUDENT', alpha.classB.id)).user;
    parentOfA = (await alpha.createParentOf(enrolledA.student.id)).user;
  });

  afterAll(() => prisma.$disconnect());

  it('lets a student open a published lesson file in their own class', async () => {
    const res = await view(classAFileId, studentA);
    expect(res.status).toBe(200);
    expect(res.body.data.id).toBe(classAFileId);
  });

  it("lets a parent open their child's class lesson file", async () => {
    const res = await view(classAFileId, parentOfA);
    expect(res.status).toBe(200);
  });

  it("hides another class's lesson file from a student", async () => {
    expect((await view(classBFileId, studentA)).status).toBe(404);
    expect((await view(classAFileId, studentB)).status).toBe(404);
  });

  it("hides another class's lesson file from a parent", async () => {
    expect((await view(classBFileId, parentOfA)).status).toBe(404);
  });

  it('keeps staff access within the school', async () => {
    expect((await view(classBFileId, teacher)).status).toBe(200);
    expect((await view(betaFileId, teacher)).status).toBe(404);
  });

  it("never serves another school's file", async () => {
    expect((await view(betaFileId, studentA)).status).toBe(404);
  });

  it('hides unpublished lesson files from students', async () => {
    await prisma.lesson.updateMany({
      where: { fileAssetId: classAFileId },
      data: { isPublished: false },
    });
    expect((await view(classAFileId, studentA)).status).toBe(404);
    await prisma.lesson.updateMany({
      where: { fileAssetId: classAFileId },
      data: { isPublished: true },
    });
  });
});

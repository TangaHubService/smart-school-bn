import request from 'supertest';

import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';
import { accessTokenFor, createSchool, resetDatabase, type TestUser } from './fixtures';

/**
 * The public academy school (the tenant flagged `isAcademyCatalog`) must be
 * able to build its whole catalog through the normal admin screens' API, and
 * everything it publishes must show up on the public academy pages.
 */
describe('public academy school (real database)', () => {
  const app = createApp();
  let admin: TestUser;
  let auth: { Authorization: string };

  beforeAll(async () => {
    await resetDatabase();
    const school = await createSchool('Academy');
    await prisma.tenant.update({
      where: { id: school.tenant.id },
      data: { isAcademyCatalog: true },
    });
    // The academy school is never billed: prove it works with no paid invoice at all.
    await prisma.subscriptionInvoice.deleteMany({ where: { tenantId: school.tenant.id } });

    admin = await school.createUser('SCHOOL_ADMIN', {
      email: 'admin@academy.test',
      password: 'Admin-pass-1',
    });
    auth = { Authorization: `Bearer ${accessTokenFor(admin)}` };
  });

  afterAll(async () => {
    await prisma.$disconnect();
  });

  it('asks the academy admin for an emailed code at sign-in', async () => {
    const res = await request(app)
      .post('/auth/login')
      .send({ identifier: 'admin@academy.test', password: 'Admin-pass-1' });
    expect(res.status).toBe(200);
    expect(res.body.data).toMatchObject({ requiresTwoFactor: true });
    expect(res.body.data.accessToken).toBeUndefined();
  });

  it('lets the admin build a class with courses and lessons, and publishes them', async () => {
    const day = 86_400_000;
    // A year that is NOT marked current: its courses must still be public.
    const year = await request(app)
      .post('/academic-years')
      .set(auth)
      .send({
        name: '2027 Intake',
        startDate: new Date(Date.now() + 30 * day).toISOString(),
        endDate: new Date(Date.now() + 365 * day).toISOString(),
        isCurrent: false,
      });
    expect(year.status).toBe(201);

    const grade = await request(app)
      .post('/grade-levels')
      .set(auth)
      .send({ code: 'S1', name: 'Senior 1', rank: 7 });
    expect(grade.status).toBe(201);

    const classRoom = await request(app)
      .post('/classes')
      .set(auth)
      .send({
        gradeLevelId: grade.body.data.id,
        code: 'S1-PUB',
        name: 'Senior 1 Online',
        price: 7000,
        listedInPublicCatalog: true,
      });
    expect(classRoom.status).toBe(201);

    const subject = await request(app)
      .post('/subjects')
      .set(auth)
      .send({ code: 'BIO', name: 'Biology' });
    expect(subject.status).toBe(201);

    const course = await request(app)
      .post('/courses')
      .set(auth)
      .send({
        academicYearId: year.body.data.id,
        classRoomId: classRoom.body.data.id,
        subjectId: subject.body.data.id,
        title: 'Senior 1 Biology',
      });
    expect(course.status).toBe(201);

    // Courses do not have to belong to a subject.
    const general = await request(app)
      .post('/courses')
      .set(auth)
      .send({
        academicYearId: year.body.data.id,
        classRoomId: classRoom.body.data.id,
        title: 'Study Skills',
      });
    expect(general.status).toBe(201);

    const lesson = await request(app)
      .post(`/courses/${course.body.data.id}/lessons`)
      .set(auth)
      .send({ title: 'Cells', contentType: 'TEXT', body: '<p>Cells are the unit of life.</p>' });
    expect(lesson.status).toBe(201);

    const published = await request(app)
      .patch(`/lessons/${lesson.body.data.id}/publish`)
      .set(auth)
      .send({ isPublished: true });
    expect(published.status).toBe(200);

    const tree = await request(app).get('/public-academy/catalog/tree');
    expect(tree.status).toBe(200);
    const rooms = tree.body.data.academicYears.flatMap((y: any) =>
      y.gradeLevels.flatMap((g: any) => g.classRooms)
    );
    const room = rooms.find((r: any) => r.id === classRoom.body.data.id);
    expect(room).toBeDefined();
    expect(room.price).toBe(7000);
    const titles = room.subjects.flatMap((s: any) => s.courses.map((c: any) => c.title));
    expect(titles).toEqual(expect.arrayContaining(['Senior 1 Biology', 'Study Skills']));

    const classes = await request(app).get('/public-academy/classes');
    expect(classes.status).toBe(200);
    expect(classes.body.data.map((c: any) => c.id)).toContain(classRoom.body.data.id);
  });

  it('hides a class from the public catalog when the admin unlists it', async () => {
    const grade = await request(app)
      .post('/grade-levels')
      .set(auth)
      .send({ code: 'S2', name: 'Senior 2', rank: 8 });
    const hidden = await request(app)
      .post('/classes')
      .set(auth)
      .send({
        gradeLevelId: grade.body.data.id,
        code: 'S2-PRIV',
        name: 'Senior 2 Private',
        listedInPublicCatalog: false,
      });
    expect(hidden.status).toBe(201);

    const classes = await request(app).get('/public-academy/classes');
    expect(classes.body.data.map((c: any) => c.id)).not.toContain(hidden.body.data.id);
  });
});

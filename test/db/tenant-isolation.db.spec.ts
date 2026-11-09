import request from 'supertest';

import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';
import { accessTokenFor, createSchool, resetDatabase } from './fixtures';

describe('tenant isolation (real database)', () => {
  const app = createApp();
  let alpha: Awaited<ReturnType<typeof createSchool>>;
  let beta: Awaited<ReturnType<typeof createSchool>>;
  let alphaAdminToken: string;
  let betaStudentId: string;
  let alphaStudentId: string;

  beforeAll(async () => {
    await resetDatabase();
    alpha = await createSchool('Alpha');
    beta = await createSchool('Beta');
    const alphaAdmin = await alpha.createUser('SCHOOL_ADMIN', { password: 'Admin-pass-1' });
    alphaAdminToken = accessTokenFor(alphaAdmin);
    alphaStudentId = (await alpha.createStudent('ALPHA-1', alpha.classA.id)).student.id;
    betaStudentId = (await beta.createStudent('BETA-1', beta.classA.id)).student.id;
  });

  afterAll(() => prisma.$disconnect());

  it("lists only the caller's own school's students", async () => {
    const res = await request(app)
      .get('/students')
      .set('Authorization', `Bearer ${alphaAdminToken}`);
    expect(res.status).toBe(200);
    const ids = res.body.data.items.map((s: { id: string }) => s.id);
    expect(ids).toContain(alphaStudentId);
    expect(ids).not.toContain(betaStudentId);
  });

  it("cannot read another school's student by id", async () => {
    const res = await request(app)
      .get(`/students/${betaStudentId}`)
      .set('Authorization', `Bearer ${alphaAdminToken}`);
    expect(res.status).toBe(404);
  });

  it("cannot edit another school's student by id", async () => {
    const res = await request(app)
      .patch(`/students/${betaStudentId}`)
      .set('Authorization', `Bearer ${alphaAdminToken}`)
      .send({ firstName: 'Hijacked' });
    expect([403, 404]).toContain(res.status);
    const unchanged = await prisma.student.findUnique({ where: { id: betaStudentId } });
    expect(unchanged?.firstName).not.toBe('Hijacked');
  });

  it('rejects a request that names a different tenant in x-tenant-id', async () => {
    const res = await request(app)
      .get('/students')
      .set('Authorization', `Bearer ${alphaAdminToken}`)
      .set('x-tenant-id', beta.tenant.id);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('TENANT_MISMATCH');
  });

  it('blocks a school admin from SuperAdmin tenant management', async () => {
    const res = await request(app)
      .get('/tenants')
      .set('Authorization', `Bearer ${alphaAdminToken}`);
    expect(res.status).toBe(403);
  });
});

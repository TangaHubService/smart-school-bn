import crypto from 'crypto';

import request from 'supertest';

import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';
import { resetDatabase } from './fixtures';

/**
 * Routes that must work without a session. Most routers are mounted at `/`
 * with a blanket `router.use(authenticate)`, which used to turn these into 401s.
 */
describe('public routes (real database)', () => {
  const app = createApp();
  const unknownId = '00000000-0000-4000-8000-000000000000';

  beforeAll(resetDatabase);
  afterAll(() => prisma.$disconnect());

  it('serves QR report-card verification anonymously (404 for an unknown card, not 401)', async () => {
    const res = await request(app).get(`/report-cards/verify/${unknownId}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('REPORT_CARD_NOT_FOUND');
  });

  it('serves the public report-card PDF route anonymously', async () => {
    const res = await request(app).get(`/report-cards/public/${unknownId}/pdf`);
    expect(res.status).toBe(404);
  });

  it('serves location lookups to anonymous registration forms', async () => {
    const res = await request(app).get('/locations/countries');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data)).toBe(true);
  });

  it('accepts the public contact form without a session (reaches validation)', async () => {
    const res = await request(app).post('/support/tickets/public').send({});
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('hides the 100 RWF "test" academy plan unless explicitly enabled', async () => {
    const res = await request(app).get('/public-academy/plans');
    expect(res.status).toBe(200);
    const ids = res.body.data.plans.map((plan: { id: string }) => plan.id);
    expect(ids).not.toContain('test');
    expect(ids).toEqual(expect.arrayContaining(['weekly', 'monthly', 'yearly']));
    expect(res.body.data.mockBillingEnabled).toBe(false);
  });

  describe.each([
    ['school billing', '/webhooks/paypack'],
    ['public academy', '/public-academy/webhook/paypack'],
  ])('%s Paypack webhook', (_label, path) => {
    const body = JSON.stringify({ data: { ref: 'unknown-ref', status: 'successful' } });
    const sign = (secret: string) =>
      crypto.createHmac('sha256', secret).update(body).digest('base64');

    it('rejects an unsigned callback', async () => {
      const res = await request(app).post(path).set('Content-Type', 'application/json').send(body);
      expect(res.status).toBe(401);
    });

    it('rejects a callback signed with the wrong secret', async () => {
      const res = await request(app)
        .post(path)
        .set('Content-Type', 'application/json')
        .set('X-Paypack-Signature', sign('not-the-secret'))
        .send(body);
      expect(res.status).toBe(401);
    });

    it('accepts a correctly signed callback (unknown ref is ignored)', async () => {
      const res = await request(app)
        .post(path)
        .set('Content-Type', 'application/json')
        .set('X-Paypack-Signature', sign(process.env.PAYPACK_WEBHOOK_SECRET!))
        .send(body);
      expect(res.status).toBe(200);
    });
  });
});

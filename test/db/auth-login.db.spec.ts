import request from 'supertest';

import { createApp } from '../../src/app';
import { prisma } from '../../src/db/prisma';
import { EmailService } from '../../src/modules/notifications/email.service';
import { createSchool, resetDatabase } from './fixtures';

describe('sign-in flows (real database)', () => {
  const app = createApp();
  const sentCodes: string[] = [];
  let school: Awaited<ReturnType<typeof createSchool>>;
  let otherSchool: Awaited<ReturnType<typeof createSchool>>;

  beforeAll(async () => {
    await resetDatabase();
    jest
      .spyOn(EmailService.prototype, 'sendTwoFactorOtp')
      .mockImplementation(async ({ otp }: { otp: string }) => {
        sentCodes.push(otp);
      });
    school = await createSchool('Alpha');
    otherSchool = await createSchool('Beta');
  });

  afterAll(async () => {
    jest.restoreAllMocks();
    await prisma.$disconnect();
  });

  describe('student starter credentials', () => {
    it('never issues a session for password = student code; requires a new password', async () => {
      await school.createStudent('STU-A1', school.classA.id);

      const res = await request(app)
        .post('/auth/login')
        .send({ identifier: 'STU-A1', password: 'STU-A1' });

      expect(res.status).toBe(200);
      expect(res.body.data.requiresPasswordChange).toBe(true);
      expect(res.body.data.challengeToken).toEqual(expect.any(String));
      expect(res.body.data.accessToken).toBeUndefined();
      expect(res.body.data.refreshToken).toBeUndefined();
    });

    it('lets the student set a new password, then signs them in; the challenge is single-use', async () => {
      await school.createStudent('STU-A2', school.classA.id);
      const start = await request(app)
        .post('/auth/login')
        .send({ identifier: 'stu-a2', password: 'STU-A2' });
      const { challengeToken } = start.body.data;

      const reuseStarter = await request(app)
        .post('/auth/complete-password-change')
        .send({ challengeToken, newPassword: 'STU-A2' });
      expect(reuseStarter.status).toBe(400);

      const done = await request(app)
        .post('/auth/complete-password-change')
        .send({ challengeToken, newPassword: 'my-own-pass-42' });
      expect(done.status).toBe(200);
      expect(done.body.data.accessToken).toEqual(expect.any(String));
      expect(done.body.data.roles).toEqual(['STUDENT']);

      const replay = await request(app)
        .post('/auth/complete-password-change')
        .send({ challengeToken, newPassword: 'another-pass-77' });
      expect(replay.status).toBe(401);

      const oldStarter = await request(app)
        .post('/auth/login')
        .send({ identifier: 'STU-A2', password: 'STU-A2' });
      expect(oldStarter.status).toBe(401);

      const newLogin = await request(app)
        .post('/auth/login')
        .send({ identifier: 'STU-A2', password: 'my-own-pass-42' });
      expect(newLogin.status).toBe(200);
      expect(newLogin.body.data.accessToken).toEqual(expect.any(String));
    });

    it('does not let a student code from another school open this school’s account', async () => {
      await otherSchool.createStudent('STU-SHARED', otherSchool.classA.id);
      const { user } = await school.createStudent('STU-SHARED', school.classA.id);
      // This school's student has already chosen a real password.
      await prisma.user.update({
        where: { id: user.id },
        data: { passwordHash: await (await import('bcrypt')).hash('alpha-private-9', 8) },
      });

      const res = await request(app)
        .post('/auth/login')
        .send({ identifier: 'STU-SHARED', password: 'STU-SHARED' });

      // Only the Beta account still uses the code as its password, and it is
      // forced into a password change; the Alpha account is never touched.
      expect(res.status).toBe(200);
      expect(res.body.data.requiresPasswordChange).toBe(true);
      expect(res.body.data.accessToken).toBeUndefined();
    });

    it('rejects a wrong password', async () => {
      const res = await request(app)
        .post('/auth/login')
        .send({ identifier: 'STU-A1', password: 'not-the-password' });
      expect(res.status).toBe(401);
    });

    it('a challenge token is not an access token', async () => {
      const start = await request(app)
        .post('/auth/login')
        .send({ identifier: 'STU-A1', password: 'STU-A1' });
      const res = await request(app)
        .get('/me')
        .set('Authorization', `Bearer ${start.body.data.challengeToken}`);
      expect(res.status).toBe(401);
    });
  });

  describe('two-factor sign-in for staff', () => {
    it('works when the teacher signs in with a username (not an email)', async () => {
      await school.createUser('TEACHER', { username: 'teacher_alpha', password: 'Teacher-pass-1' });

      const start = await request(app)
        .post('/auth/login')
        .send({ identifier: 'teacher_alpha', password: 'Teacher-pass-1' });
      expect(start.status).toBe(200);
      expect(start.body.data).toMatchObject({ requiresTwoFactor: true });
      expect(start.body.data.accessToken).toBeUndefined();
      expect(start.body.data.destination).toMatch(/\*/);

      const code = sentCodes[sentCodes.length - 1];
      const verify = await request(app)
        .post('/auth/verify-two-factor')
        .send({ challengeToken: start.body.data.challengeToken, otp: code });
      expect(verify.status).toBe(200);
      expect(verify.body.data.accessToken).toEqual(expect.any(String));
      expect(verify.body.data.roles).toEqual(['TEACHER']);
    });

    it('locks the code after too many wrong guesses, and resending does not reset the count', async () => {
      await school.createUser('SCHOOL_ADMIN', {
        username: 'admin_alpha',
        password: 'Admin-pass-1',
      });
      const start = await request(app)
        .post('/auth/login')
        .send({ identifier: 'admin_alpha', password: 'Admin-pass-1' });
      const { challengeToken } = start.body.data;
      const realCode = sentCodes[sentCodes.length - 1];
      const wrong = realCode === '000000' ? '111111' : '000000';

      for (let attempt = 0; attempt < 5; attempt += 1) {
        const res = await request(app)
          .post('/auth/verify-two-factor')
          .send({ challengeToken, otp: wrong });
        expect(res.status).toBe(400);
      }

      // Allow an immediate resend for this test.
      await prisma.user.updateMany({
        where: { username: 'admin_alpha' },
        data: { lastOtpSentAt: new Date(Date.now() - 60 * 60 * 1000) },
      });
      const resend = await request(app)
        .post('/auth/resend-two-factor-otp')
        .send({ challengeToken });
      expect(resend.status).toBe(200);

      const locked = await request(app)
        .post('/auth/verify-two-factor')
        .send({ challengeToken, otp: sentCodes[sentCodes.length - 1] });
      expect(locked.status).toBe(429);
    });

    it('rejects a forged or tampered challenge token', async () => {
      const res = await request(app)
        .post('/auth/verify-two-factor')
        .send({ challengeToken: 'x'.repeat(40), otp: '123456' });
      expect(res.status).toBe(401);
    });
  });
});

import { Prisma, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash, randomBytes, randomInt, randomUUID } from 'crypto';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env';
import { rootLogger } from '../../config/logger';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { normalizePermissions } from '../../common/utils/permission-utils';
import { ttlToSeconds } from '../../common/utils/time';
import { AuditService } from '../audit/audit.service';
import { resolvePrimaryRole } from '../audit/audit-log.utils';
import { EmailService } from '../notifications/email.service';
import { resolveAcademyCatalogTenantId } from '../public-academy/academy-catalog';
import { AcademySubscriptionService } from '../public-academy/academy-subscription.service';
import { CompletePasswordChangeInput, ForgotPasswordInput, LoginInput, LogoutInput, RefreshInput, RegisterInput, RequestPasswordResetInput, ResetPasswordInput, SelectSchoolInput, VerifyOtpInput } from './auth.schemas';
import {
  isStarterCredential,
  issueAuthChallenge,
  passwordFingerprint,
  readAuthChallenge,
} from './auth-challenge.utils';
import { generateOtp, hashOtp, verifyOtpHash } from './otp.utils';

const LOGIN_USER_INCLUDE = {
  tenant: {
    select: {
      name: true,
      school: { select: { displayName: true } },
    },
  },
  userRoles: { include: { role: true } },
} satisfies Prisma.UserInclude;

type LoginCandidate = Prisma.UserGetPayload<{ include: typeof LOGIN_USER_INCLUDE }>;

const PUBLIC_LEARNER_PERMISSIONS = [
  'students.my_courses.read',
  'assignments.submit',
  'assessments.submit',
  'files.upload',
  'chat.read',
  'chat.send',
];

export class AuthService {
  private readonly auditService = new AuditService();
  private readonly emailService = new EmailService();
  private readonly academySubscriptionService = new AcademySubscriptionService();

  async login(input: LoginInput, context: RequestAuditContext) {
    const { identifier, password } = input;
    const trimmedIdentifier = identifier.trim();

    // 1. Find every active account this identifier can name: email, username, or the
    //    student code of a linked student profile. Passwords are always checked with
    //    bcrypt; a student code is never accepted as proof on its own.
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { equals: trimmedIdentifier, mode: 'insensitive' } },
          { username: { equals: trimmedIdentifier, mode: 'insensitive' } },
          {
            studentProfile: {
              studentCode: { equals: trimmedIdentifier, mode: 'insensitive' },
              deletedAt: null,
              isActive: true,
            },
          },
        ],
        deletedAt: null,
        status: UserStatus.ACTIVE,
        tenant: {
          isActive: true,
        },
      },
      include: LOGIN_USER_INCLUDE,
    });

    if (!users.length) {
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }

    // 2. Validate password for each candidate
    const matchedUsers: Array<(typeof users)[number]> = [];

    for (const user of users) {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (isMatch) {
        matchedUsers.push(user);
      }
    }

    if (!matchedUsers.length) {
      await Promise.all(
        users.map(user =>
          this.auditService.log({
            tenantId: user.tenantId,
            actorUserId: user.id,
            event: AUDIT_EVENT.AUTH_LOGIN_FAILED,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            payload: { reason: 'WRONG_PASSWORD', identifier: trimmedIdentifier },
          })
        )
      );

      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }

    // 3. Resolve ambiguity (existing multi-tenant resolution logic)
    const resolvedUser = this.resolveMatchedEmailUser(matchedUsers);
    if (!resolvedUser) {
      await Promise.all(
        matchedUsers.map(user =>
          this.auditService.log({
            tenantId: user.tenantId,
            actorUserId: user.id,
            event: AUDIT_EVENT.AUTH_LOGIN_FAILED,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            payload: { reason: 'AMBIGUOUS_IDENTIFIER', identifier: trimmedIdentifier },
          })
        )
      );

      throw new AppError(
        409,
        'AUTH_AMBIGUOUS_ACCOUNT',
        'Multiple accounts match this identifier',
        { matchedSchools: matchedUsers.map(u => ({ tenantId: u.tenantId, tenantName: u.tenant.name, schoolName: u.tenant.school?.displayName ?? u.tenant.name })) }
      );
    }

    return this.continueAfterPassword(resolvedUser, password, context);
  }

  async selectSchool(input: SelectSchoolInput, context: RequestAuditContext) {
    const { identifier, password, tenantId } = input;
    const trimmedIdentifier = identifier.trim();

    const user = await prisma.user.findFirst({
      where: {
        tenantId,
        OR: [
          { email: { equals: trimmedIdentifier, mode: 'insensitive' } },
          { username: { equals: trimmedIdentifier, mode: 'insensitive' } },
          {
            studentProfile: {
              studentCode: { equals: trimmedIdentifier, mode: 'insensitive' },
              deletedAt: null,
              isActive: true,
            },
          },
        ],
        deletedAt: null,
        status: UserStatus.ACTIVE,
        tenant: { isActive: true },
      },
      include: LOGIN_USER_INCLUDE,
    });

    if (!user) {
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }

    const isMatch = await bcrypt.compare(password, user.passwordHash);
    if (!isMatch) {
      await this.auditService.log({
        tenantId: user.tenantId,
        actorUserId: user.id,
        event: AUDIT_EVENT.AUTH_LOGIN_FAILED,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: { reason: 'WRONG_PASSWORD', identifier: trimmedIdentifier },
      });
      throw new AppError(401, 'AUTH_INVALID_CREDENTIALS', 'Invalid credentials');
    }

    return this.continueAfterPassword(user, password, context);
  }

  /**
   * Single place that decides what happens once a password has been verified:
   * 1. a starter credential (password = username / student code) must be replaced first;
   * 2. privileged roles then go through an emailed one-time code;
   * 3. everyone else gets a session.
   */
  private async continueAfterPassword(
    user: LoginCandidate,
    password: string | null,
    context: RequestAuditContext
  ) {
    if (password !== null && (await this.isUsingStarterCredential(user, password))) {
      await this.auditService.log({
        tenantId: user.tenantId,
        actorUserId: user.id,
        event: AUDIT_EVENT.AUTH_LOGIN_FAILED,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: { reason: 'PASSWORD_CHANGE_REQUIRED' },
      });
      return {
        requiresPasswordChange: true as const,
        challengeToken: issueAuthChallenge(user, 'password_change'),
      };
    }

    return this.completeLogin(user.tenantId, user, context);
  }

  private async isUsingStarterCredential(user: LoginCandidate, password: string) {
    const student = await prisma.student.findFirst({
      where: { userId: user.id, tenantId: user.tenantId },
      select: { studentCode: true },
    });
    return isStarterCredential(password, [user.username, student?.studentCode]);
  }

  async completePasswordChange(input: CompletePasswordChangeInput, context: RequestAuditContext) {
    const challenge = readAuthChallenge(input.challengeToken, 'password_change');

    const user = await prisma.user.findFirst({
      where: {
        id: challenge.sub,
        tenantId: challenge.tid,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        tenant: { isActive: true },
      },
      include: LOGIN_USER_INCLUDE,
    });

    if (!user || passwordFingerprint(user.passwordHash) !== challenge.pwf) {
      throw new AppError(
        401,
        'AUTH_CHALLENGE_INVALID',
        'This sign-in step has expired. Please sign in again.'
      );
    }

    if (await this.isUsingStarterCredential(user, input.newPassword)) {
      throw new AppError(
        400,
        'AUTH_PASSWORD_TOO_WEAK',
        'Choose a password that is different from your username or student code.'
      );
    }

    const passwordHash = await bcrypt.hash(input.newPassword, env.BCRYPT_ROUNDS);
    const updated = await prisma.user.update({
      where: { id: user.id },
      data: { passwordHash },
      include: LOGIN_USER_INCLUDE,
    });

    await this.auditService.log({
      tenantId: user.tenantId,
      actorUserId: user.id,
      event: AUDIT_EVENT.USER_PASSWORD_RESET_SUCCESS,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { reason: 'STARTER_PASSWORD_REPLACED' },
    });

    return this.continueAfterPassword(updated, null, context);
  }

  async register(input: RegisterInput, context: RequestAuditContext) {
    const { firstName, lastName, email, username, password } = input;
    const normalizedEmail = email.toLowerCase().trim();
    const normalizedUsername = username.toLowerCase().trim();

    const catalogTenantId = await resolveAcademyCatalogTenantId();
    if (!catalogTenantId) {
      throw new AppError(503, 'AUTH_ACADEMY_NOT_CONFIGURED', 'No academy catalog school is set.');
    }

    const academyTenant = await prisma.tenant.findFirst({
      where: { id: catalogTenantId, isActive: true },
    });

    if (!academyTenant) {
      throw new AppError(503, 'AUTH_ACADEMY_NOT_CONFIGURED', 'Academy catalog tenant is missing.');
    }

    const existingEmail = await prisma.user.findFirst({
      where: {
        email: normalizedEmail,
        deletedAt: null,
      },
    });

    if (existingEmail) {
      throw new AppError(409, 'AUTH_USER_EXISTS', 'An account already exists with this email.');
    }

    const existingUsername = await prisma.user.findFirst({
      where: {
        tenantId: academyTenant.id,
        username: normalizedUsername,
      },
    });

    if (existingUsername) {
      throw new AppError(409, 'AUTH_USERNAME_TAKEN', 'This username is already taken.');
    }

    // Revision #12: ensure both PUBLIC_LEARNER (legacy) and LEARNER roles exist.
    const learnerRole = await prisma.role.upsert({
      where: {
        tenantId_name: {
          tenantId: academyTenant.id,
          name: 'PUBLIC_LEARNER',
        },
      },
      update: {
        permissions: PUBLIC_LEARNER_PERMISSIONS,
      },
      create: {
        tenantId: academyTenant.id,
        name: 'PUBLIC_LEARNER',
        description: 'Public academy learner',
        isSystem: true,
        permissions: PUBLIC_LEARNER_PERMISSIONS,
      },
    });

    const modernLearnerRole = await prisma.role.upsert({
      where: {
        tenantId_name: {
          tenantId: academyTenant.id,
          name: 'LEARNER',
        },
      },
      update: {
        permissions: PUBLIC_LEARNER_PERMISSIONS,
      },
      create: {
        tenantId: academyTenant.id,
        name: 'LEARNER',
        description: 'Academy learner role (Public Academy students)',
        isSystem: true,
        permissions: PUBLIC_LEARNER_PERMISSIONS,
      },
    });

    // Create User
    const passwordHash = await bcrypt.hash(password, env.BCRYPT_ROUNDS);

    const user = await prisma.$transaction(async tx => {
      const newUser = await tx.user.create({
        data: {
          tenantId: academyTenant.id,
          email: normalizedEmail,
          username: normalizedUsername,
          firstName,
          lastName,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });

      await tx.student.create({
        data: {
          tenantId: academyTenant.id,
          userId: newUser.id,
          studentCode: normalizedUsername.toUpperCase(),
          firstName,
          lastName,
          isActive: true,
        },
      });

      await tx.userRole.create({
        data: {
          tenantId: academyTenant.id,
          userId: newUser.id,
          roleId: learnerRole.id,
        },
      });

      await tx.userRole.create({
        data: {
          tenantId: academyTenant.id,
          userId: newUser.id,
          roleId: modernLearnerRole.id,
        },
      });

      await this.academySubscriptionService.ensureTrialSubscription(
        newUser.id,
        academyTenant.id,
        tx
      );

      return tx.user.findUniqueOrThrow({
        where: { id: newUser.id },
        include: {
          tenant: {
            select: {
              name: true,
              school: {
                select: {
                  displayName: true,
                },
              },
            },
          },
          userRoles: {
            include: {
              role: true,
            },
          },
        },
      });
    });

    return this.completeLogin(academyTenant.id, user, context);
  }

  async refresh(input: RefreshInput, context: RequestAuditContext) {
    const hashedToken = this.hashRefreshToken(input.refreshToken);

    const existingToken = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashedToken },
      include: {
        tenant: {
          select: {
            id: true,
            name: true,
            isActive: true,
            school: {
              select: {
                displayName: true,
              },
            },
          },
        },
        user: {
          include: {
            userRoles: {
              include: {
                role: true,
              },
            },
          },
        },
      },
    });

    if (
      !existingToken ||
      existingToken.revokedAt ||
      existingToken.expiresAt <= new Date() ||
      existingToken.user.deletedAt ||
      existingToken.user.status !== UserStatus.ACTIVE ||
      !existingToken.tenant.isActive
    ) {
      throw new AppError(401, 'AUTH_INVALID_REFRESH_TOKEN', 'Invalid refresh token');
    }

    const { roles, permissions } = this.extractRolesAndPermissions(existingToken.user.userRoles);

    const payload: JwtUser = {
      sub: existingToken.user.id,
      tenantId: existingToken.tenantId,
      email: existingToken.user.email,
      roles,
      permissions,
      firstName: existingToken.user.firstName,
      lastName: existingToken.user.lastName,
      primaryRole: resolvePrimaryRole(roles) ?? undefined,
      schoolName: existingToken.tenant.school?.displayName ?? existingToken.tenant.name,
      sessionId: existingToken.sessionId ?? context.sessionId ?? randomUUID(),
    };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    });

    const nextRefreshToken = this.generateRefreshToken();
    const nextRefreshHash = this.hashRefreshToken(nextRefreshToken);
    const nextRefreshExpiry = new Date(
      Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000
    );

    await prisma.$transaction(async tx => {
      const created = await tx.refreshToken.create({
        data: {
          tenantId: existingToken.tenantId,
          userId: existingToken.userId,
          tokenHash: nextRefreshHash,
          sessionId: payload.sessionId,
          expiresAt: nextRefreshExpiry,
          createdByIp: context.ipAddress,
          userAgent: context.userAgent,
        },
      });

      await tx.refreshToken.update({
        where: { id: existingToken.id },
        data: {
          revokedAt: new Date(),
          replacedByTokenId: created.id,
        },
      });
    });

    await this.auditService.log({
      tenantId: existingToken.tenantId,
      actorUserId: existingToken.userId,
      event: AUDIT_EVENT.AUTH_REFRESH_SUCCESS,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      sessionId: payload.sessionId,
    });

    return {
      accessToken,
      accessTokenExpiresIn: ttlToSeconds(env.ACCESS_TOKEN_TTL),
      refreshToken: nextRefreshToken,
    };
  }

  async logout(input: LogoutInput, user: JwtUser, context: RequestAuditContext) {
    if (!input.allDevices && !input.refreshToken) {
      throw new AppError(
        400,
        'AUTH_LOGOUT_TOKEN_REQUIRED',
        'refreshToken is required when allDevices is false'
      );
    }

    let logoutSessionId = user.sessionId ?? context.sessionId ?? null;

    if (input.allDevices) {
      await prisma.refreshToken.updateMany({
        where: {
          tenantId: user.tenantId,
          userId: user.sub,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    } else if (input.refreshToken) {
      const tokenHash = this.hashRefreshToken(input.refreshToken);
      const existingToken = await prisma.refreshToken.findUnique({
        where: { tokenHash },
        select: { sessionId: true },
      });
      logoutSessionId = existingToken?.sessionId ?? logoutSessionId;
      await prisma.refreshToken.updateMany({
        where: {
          tenantId: user.tenantId,
          userId: user.sub,
          tokenHash,
          revokedAt: null,
        },
        data: {
          revokedAt: new Date(),
        },
      });
    }

    await this.auditService.log({
      tenantId: user.tenantId,
      actorUserId: user.sub,
      event: AUDIT_EVENT.AUTH_LOGOUT,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      sessionId: logoutSessionId,
      payload: {
        allDevices: input.allDevices,
      },
    });

    return {
      loggedOut: true,
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256').update(`${token}:${env.JWT_REFRESH_SECRET}`).digest('hex');
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('hex');
  }

  private resolveMatchedEmailUser<
    T extends {
      id: string;
      userRoles: Array<{ role: { name: string } }>;
    },
  >(users: T[]): T | null {
    if (users.length === 1) {
      return users[0];
    }

    const superAdmins = users.filter(user =>
      (user.userRoles ?? []).some(item => item.role.name === 'SUPER_ADMIN')
    );

    if (superAdmins.length === 1) {
      return superAdmins[0];
    }

    return null;
  }

  private async completeLogin(
    tenantId: string,
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      tenant?: {
        name: string;
        school?: {
          displayName: string;
        } | null;
      } | null;
      userRoles: Array<{ role: { name: string; permissions: unknown } }>;
    },
    context: RequestAuditContext
  ) {
    const { roles, permissions } = this.extractRolesAndPermissions(user.userRoles);
    const sessionId = randomUUID();

    const payload: JwtUser = {
      sub: user.id,
      tenantId,
      email: user.email,
      roles,
      permissions,
      firstName: user.firstName,
      lastName: user.lastName,
      primaryRole: resolvePrimaryRole(roles) ?? undefined,
      schoolName: user.tenant?.school?.displayName ?? user.tenant?.name ?? null,
      sessionId,
    };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    });

    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const refreshExpiry = new Date(Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000);

    await prisma.$transaction(async tx => {
      await tx.refreshToken.create({
        data: {
          tenantId,
          userId: user.id,
          tokenHash: refreshTokenHash,
          sessionId,
          expiresAt: refreshExpiry,
          createdByIp: context.ipAddress,
          userAgent: context.userAgent,
        },
      });

      await tx.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      });
    });

    await this.auditService.log({
      tenantId,
      actorUserId: user.id,
      event: AUDIT_EVENT.AUTH_LOGIN_SUCCESS,
      entity: 'User',
      entityId: user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      sessionId,
    });

    return {
      accessToken,
      accessTokenExpiresIn: ttlToSeconds(env.ACCESS_TOKEN_TTL),
      refreshToken,
      user: {
        id: user.id,
        tenantId,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
      },
      roles,
      permissions,
    };
  }

  private extractRolesAndPermissions(
    userRoles: Array<{ role: { name: string; permissions: unknown } }>
  ): { roles: string[]; permissions: string[] } {
    const roles = userRoles.map(item => item.role.name);
    const permissions = [
      ...new Set(userRoles.flatMap(item => normalizePermissions(item.role.permissions))),
    ];

    return { roles, permissions };
  }

  async forgotPassword(input: RequestPasswordResetInput, context: RequestAuditContext) {
    const { email } = input;
    const normalized = email.toLowerCase().trim();

    // 1. Find user
    const user = await prisma.user.findFirst({
      where: {
        email: normalized,
        deletedAt: null,
      },
    });

    if (!user) {
      // Return success anyway to avoid user enumeration
      return { message: 'If your account exists, an OTP has been sent.' };
    }

    // 2. Generate 6-digit OTP
    const otp = Math.floor(100000 + Math.random() * 900000).toString();
    const expiresAt = new Date(Date.now() + 60 * 60 * 1000); // 1 hour

    // 3. Store OTP
    await prisma.passwordResetToken.upsert({
      where: {
        tenantId_email: {
          tenantId: user.tenantId,
          email: user.email,
        },
      },
      update: {
        otp,
        expiresAt,
      },
      create: {
        tenantId: user.tenantId,
        email: user.email,
        otp,
        expiresAt,
      },
    });

    // 4. Log event (Audit)
    await this.auditService.log({
      tenantId: user.tenantId,
      actorUserId: user.id,
      event: AUDIT_EVENT.USER_PASSWORD_RESET_REQUESTED,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: { email: user.email },
    });

    // 5. Send Email
    await this.emailService
      .sendPasswordResetOtp({
        toEmail: user.email,
        otp,
        expiresAt,
      })
      .catch(err => {
        rootLogger.error(
          { err, email: user.email, flow: 'password_reset_otp' },
          `Failed to send password reset OTP email to ${user.email}`
        );
      });

    return { message: 'OTP sent successfully.' };
  }

  async verifyOtp(input: VerifyOtpInput, context: RequestAuditContext) {
    const { email, otp } = input;
    const normalized = email.toLowerCase().trim();

    const tokenRecord = await prisma.passwordResetToken.findFirst({
      where: {
        email: normalized,
        otp,
        expiresAt: { gt: new Date() },
      },
    });

    if (!tokenRecord) {
      throw new AppError(400, 'AUTH_INVALID_OTP', 'Invalid or expired OTP.');
    }

    return { message: 'OTP is valid.' };
  }

  async resetPassword(input: ResetPasswordInput, context: RequestAuditContext) {
    const { email, otp, newPassword } = input;
    const normalizedEmail = email.toLowerCase().trim();

    // 1. Find valid token
    const tokenRecord = await prisma.passwordResetToken.findFirst({
      where: {
        email: normalizedEmail,
        otp,
        expiresAt: { gt: new Date() },
      },
      include: {
        tenant: true,
      },
    });

    if (!tokenRecord) {
      throw new AppError(400, 'AUTH_INVALID_OTP', 'Invalid or expired OTP');
    }

    // 2. Find user in that tenant
    const user = await prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: tokenRecord.tenantId,
          email: normalizedEmail,
        },
      },
    });

    if (!user) {
      throw new AppError(404, 'AUTH_USER_NOT_FOUND', 'User not found');
    }

    // 3. Update password
    const passwordHash = await bcrypt.hash(newPassword, env.BCRYPT_ROUNDS);

    await prisma.$transaction([
      prisma.user.update({
        where: { id: user.id },
        data: { passwordHash },
      }),
      prisma.passwordResetToken.delete({
        where: { id: tokenRecord.id },
      }),
    ]);

    // 4. Log event
    await this.auditService.log({
      tenantId: user.tenantId,
      actorUserId: user.id,
      event: AUDIT_EVENT.USER_PASSWORD_RESET_SUCCESS,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { message: 'Password reset successfully' };
  }
}

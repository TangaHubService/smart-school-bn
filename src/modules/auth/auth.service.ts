import { UserStatus } from '@prisma/client';
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
import { ForgotPasswordInput, LoginInput, LogoutInput, RefreshInput, RegisterInput, RequestPasswordResetInput, ResetPasswordInput, VerifyOtpInput, VerifyTwoFactorInput, ResendTwoFactorOtpInput } from './auth.schemas';
import { generateOtp, hashOtp } from './otp.utils';

const PUBLIC_LEARNER_PERMISSIONS = [
  'students.my_courses.read',
  'assignments.submit',
  'assessments.submit',
  'files.upload',
];

export class AuthService {
  private readonly auditService = new AuditService();
  private readonly emailService = new EmailService();
  private readonly academySubscriptionService = new AcademySubscriptionService();

  async login(input: LoginInput, context: RequestAuditContext) {
    const { identifier, password } = input;
    const trimmedIdentifier = identifier.trim();

    // 1. Find all users matching the identifier (email OR username)
    const users = await prisma.user.findMany({
      where: {
        OR: [
          { email: { equals: trimmedIdentifier, mode: 'insensitive' } },
          { username: { equals: trimmedIdentifier, mode: 'insensitive' } },
        ],
        deletedAt: null,
        status: UserStatus.ACTIVE,
        tenant: {
          isActive: true,
        },
      },
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
        'Multiple accounts match this identifier. Contact support.'
      );
    }

    // Check if user has privileged role
    const userRoles = resolvedUser.userRoles.map(ur => ur.role.name);
    const isPrivileged = userRoles.some(
      role => ['SUPER_ADMIN', 'ADMIN', 'TEACHER', 'GOV_AUDITOR'].includes(role)
    );

    if (isPrivileged) {
      // Generate OTP
      const otp = generateOtp();
      const otpHash = hashOtp(otp);
      const expiresAt = new Date(Date.now() + env.OTP_TTL_MIN * 60 * 1000);

      await prisma.user.update({
        where: { id: resolvedUser.id },
        data: {
          otpHash,
          otpExpiresAt: expiresAt,
          otpAttempts: 0,
          lastOtpSentAt: new Date(),
          isTwoFactorVerified: false,
        },
      });

      // Send OTP email
      await this.emailService.sendTwoFactorOtp({
        toEmail: resolvedUser.email,
        otp,
        expiresAt,
      });

      return {
        requiresTwoFactor: true,
      };
    }

    return this.completeLogin(resolvedUser.tenantId, resolvedUser, context);
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

    const existingEmail = await prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: academyTenant.id,
          email: normalizedEmail,
        },
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
      user.userRoles.some(item => item.role.name === 'SUPER_ADMIN')
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

  async verifyTwoFactor(input: VerifyTwoFactorInput, context: RequestAuditContext) {
    const { email, otp } = input;
    const normalized = email.toLowerCase().trim();

    const user = await prisma.user.findFirst({
      where: {
        email: normalized,
        otpHash: { not: null },
        otpExpiresAt: { gt: new Date() },
        isTwoFactorVerified: false,
      },
      include: {
        userRoles: {
          include: { role: true },
        },
        tenant: {
          select: {
            name: true,
            school: { select: { displayName: true } },
          },
        },
      },
    });

    if (!user) {
      throw new AppError(400, 'AUTH_INVALID_OTP', 'Invalid or expired OTP');
    }

    if (user.otpAttempts && user.otpAttempts >= env.OTP_MAX_ATTEMPTS) {
      throw new AppError(429, 'AUTH_OTP_ATTEMPT_LIMIT', 'Maximum OTP attempts exceeded');
    }

    const isValid = hashOtp(otp) === user.otpHash;

    if (!isValid) {
      await prisma.user.update({
        where: { id: user.id },
        data: { otpAttempts: (user.otpAttempts ?? 0) + 1 },
      });
      throw new AppError(400, 'AUTH_INVALID_OTP', 'Invalid OTP');
    }

    // OTP correct – mark as verified and clear otp fields
    await prisma.user.update({
      where: { id: user.id },
      data: {
        isTwoFactorVerified: true,
        otpHash: null,
        otpExpiresAt: null,
        otpAttempts: 0,
        lastOtpSentAt: null,
      },
    });

    // Complete login after successful 2FA
    return this.completeLogin(user.tenantId, user, context);
  }

  async resendTwoFactorOtp(input: ResendTwoFactorOtpInput, context: RequestAuditContext) {
    const { email } = input;
    const normalized = email.toLowerCase().trim();

    const user = await prisma.user.findFirst({
      where: { email: normalized },
    });
    if (!user) {
      throw new AppError(404, 'AUTH_USER_NOT_FOUND', 'User not found');
    }

    const now = new Date();
    if (user.lastOtpSentAt && now.getTime() - user.lastOtpSentAt.getTime() < env.OTP_RESEND_COOLDOWN_MIN * 60 * 1000) {
      throw new AppError(429, 'AUTH_OTP_RESEND_COOLDOWN', 'Please wait before resending OTP');
    }

    const otp = generateOtp();
    const otpHash = hashOtp(otp);
    const expiresAt = new Date(Date.now() + env.OTP_TTL_MIN * 60 * 1000);

    await prisma.user.update({
      where: { id: user.id },
      data: {
        otpHash,
        otpExpiresAt: expiresAt,
        otpAttempts: 0,
        lastOtpSentAt: now,
        isTwoFactorVerified: false,
      },
    });

    await this.emailService.sendTwoFactorOtp({
      toEmail: user.email,
      otp,
      expiresAt,
    });

    return { message: 'OTP resent successfully' };
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

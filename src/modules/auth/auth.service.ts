import { UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { normalizePermissions } from '../../common/utils/permission-utils';
import { ttlToSeconds } from '../../common/utils/time';
import { AuditService } from '../audit/audit.service';
import { grantCatalogTrialEnrollments } from '../public-academy/academy-trial';
import { resolveAcademyCatalogTenantId } from '../public-academy/academy-catalog';
import { LoginInput, LogoutInput, RefreshInput } from './auth.schemas';

const PUBLIC_LEARNER_PERMISSIONS = [
  'students.my_courses.read',
  'assessments.submit',
  'files.upload',
];

export class AuthService {
  private readonly auditService = new AuditService();

  async login(input: LoginInput, context: RequestAuditContext) {
    if (input.loginAs === 'student') {
      return this.loginStudent(input.schoolCode, input.studentId, context);
    }

    return this.loginStaff(input.email, input.password, context);
  }

  async register(input: any, context: RequestAuditContext) {
    const { firstName, lastName, email, password } = input;
    const normalizedEmail = email.toLowerCase();

    const catalogTenantId = await resolveAcademyCatalogTenantId();
    if (!catalogTenantId) {
      throw new AppError(
        503,
        'AUTH_ACADEMY_NOT_CONFIGURED',
        'No academy catalog school is set. In Super Admin → Schools, enable “Public academy catalog school” for one school, or set ACADEMY_CATALOG_TENANT_ID in server environment.',
      );
    }

    const academyTenant = await prisma.tenant.findFirst({
      where: { id: catalogTenantId, isActive: true },
    });

    if (!academyTenant) {
      throw new AppError(
        503,
        'AUTH_ACADEMY_NOT_CONFIGURED',
        'Academy catalog tenant is missing or inactive. Check ACADEMY_CATALOG_TENANT_ID and that the school is active.',
      );
    }

    const existingUser = await prisma.user.findUnique({
      where: {
        tenantId_email: {
          tenantId: academyTenant.id,
          email: normalizedEmail,
        },
      },
    });

    if (existingUser) {
      throw new AppError(409, 'AUTH_USER_EXISTS', 'An account already exists with this email.');
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

    const user = await prisma.$transaction(async (tx) => {
      const newUser = await tx.user.create({
        data: {
          tenantId: academyTenant.id,
          email: normalizedEmail,
          firstName,
          lastName,
          passwordHash,
          status: UserStatus.ACTIVE,
        },
      });

      const studentCode = `L-${randomBytes(3).toString('hex').toUpperCase()}`;
      await tx.student.create({
        data: {
          tenantId: academyTenant.id,
          userId: newUser.id,
          studentCode,
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

      return tx.user.findUniqueOrThrow({
        where: { id: newUser.id },
        include: {
          userRoles: {
            include: {
              role: true,
            },
          },
        },
      });
    });

    await grantCatalogTrialEnrollments(user.id, academyTenant.id);

    return this.completeLogin(academyTenant.id, user, context);
  }

  async refresh(input: RefreshInput, context: RequestAuditContext) {
    const hashedToken = this.hashRefreshToken(input.refreshToken);

    const existingToken = await prisma.refreshToken.findUnique({
      where: { tokenHash: hashedToken },
      include: {
        tenant: true,
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

    const { roles, permissions } = this.extractRolesAndPermissions(
      existingToken.user.userRoles,
    );

    const payload: JwtUser = {
      sub: existingToken.user.id,
      tenantId: existingToken.tenantId,
      email: existingToken.user.email,
      roles,
      permissions,
    };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    });

    const nextRefreshToken = this.generateRefreshToken();
    const nextRefreshHash = this.hashRefreshToken(nextRefreshToken);
    const nextRefreshExpiry = new Date(
      Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await prisma.$transaction(async (tx) => {
      const created = await tx.refreshToken.create({
        data: {
          tenantId: existingToken.tenantId,
          userId: existingToken.userId,
          tokenHash: nextRefreshHash,
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
        'refreshToken is required when allDevices is false',
      );
    }

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
      payload: {
        allDevices: input.allDevices,
      },
    });

    return {
      loggedOut: true,
    };
  }

  private hashRefreshToken(token: string): string {
    return createHash('sha256')
      .update(`${token}:${env.JWT_REFRESH_SECRET}`)
      .digest('hex');
  }

  private generateRefreshToken(): string {
    return randomBytes(48).toString('hex');
  }

  private async loginStaff(
    email: string,
    password: string,
    context: RequestAuditContext,
  ) {
    const normalizedEmail = email.toLowerCase();

    const users = await prisma.user.findMany({
      where: {
        email: normalizedEmail,
        deletedAt: null,
        status: UserStatus.ACTIVE,
        tenant: {
          isActive: true,
        },
      },
      include: {
        userRoles: {
          include: {
            role: true,
          },
        },
      },
    });

    if (!users.length) {
      throw new AppError(
        401,
        'AUTH_INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    }

    const matchedUsers: Array<(typeof users)[number]> = [];

    for (const user of users) {
      const isMatch = await bcrypt.compare(password, user.passwordHash);
      if (isMatch) {
        matchedUsers.push(user);
      }
    }

    if (!matchedUsers.length) {
      await Promise.all(
        users.map((user) =>
          this.auditService.log({
            tenantId: user.tenantId,
            actorUserId: user.id,
            event: AUDIT_EVENT.AUTH_LOGIN_FAILED,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            payload: { reason: 'WRONG_PASSWORD', email: normalizedEmail },
          }),
        ),
      );

      throw new AppError(
        401,
        'AUTH_INVALID_CREDENTIALS',
        'Invalid email or password',
      );
    }

    const resolvedUser = this.resolveMatchedEmailUser(matchedUsers);
    if (!resolvedUser) {
      await Promise.all(
        matchedUsers.map((user) =>
          this.auditService.log({
            tenantId: user.tenantId,
            actorUserId: user.id,
            event: AUDIT_EVENT.AUTH_LOGIN_FAILED,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            payload: { reason: 'AMBIGUOUS_EMAIL', email: normalizedEmail },
          }),
        ),
      );

      throw new AppError(
        409,
        'AUTH_AMBIGUOUS_ACCOUNT',
        'Multiple accounts match this email. Contact support.',
      );
    }

    return this.completeLogin(resolvedUser.tenantId, resolvedUser, context);
  }

  private resolveMatchedEmailUser<
    T extends {
      userRoles: Array<{ role: { name: string } }>;
    },
  >(users: T[]): T | null {
    if (users.length === 1) {
      return users[0];
    }

    const superAdmins = users.filter((user) =>
      user.userRoles.some((item) => item.role.name === 'SUPER_ADMIN'),
    );

    if (superAdmins.length === 1) {
      return superAdmins[0];
    }

    return null;
  }

  private async loginStudent(
    schoolCode: string,
    studentId: string,
    context: RequestAuditContext,
  ) {
    const normalizedSchoolCode = schoolCode.trim();
    const normalizedStudentId = studentId.trim();

    const students = await prisma.student.findMany({
      where: {
        studentCode: {
          equals: normalizedStudentId,
          mode: 'insensitive',
        },
        isActive: true,
        deletedAt: null,
        tenant: {
          code: {
            equals: normalizedSchoolCode,
            mode: 'insensitive',
          },
          isActive: true,
        },
      },
      include: {
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

    const loginCandidates = students
      .filter(
        (student) =>
          Boolean(student.user) &&
          student.user!.deletedAt === null &&
          student.user!.status === UserStatus.ACTIVE &&
          student.user!.userRoles.some((item) => item.role.name === 'STUDENT'),
      )
      .map((student) => ({
        tenantId: student.tenantId,
        user: student.user!,
      }));

    if (!loginCandidates.length) {
      throw new AppError(
        401,
        'AUTH_INVALID_CREDENTIALS',
        'Invalid student ID',
      );
    }

    if (loginCandidates.length > 1) {
      await Promise.all(
        loginCandidates.map((candidate) =>
          this.auditService.log({
            tenantId: candidate.tenantId,
            actorUserId: candidate.user.id,
            event: AUDIT_EVENT.AUTH_LOGIN_FAILED,
            requestId: context.requestId,
            ipAddress: context.ipAddress,
            userAgent: context.userAgent,
            payload: {
              reason: 'AMBIGUOUS_STUDENT_ID',
              studentId: normalizedStudentId,
            },
          }),
        ),
      );

      throw new AppError(
        409,
        'AUTH_AMBIGUOUS_STUDENT_ID',
        'Student ID is linked to multiple schools. Contact support.',
      );
    }

    const candidate = loginCandidates[0];
    return this.completeLogin(candidate.tenantId, candidate.user, context);
  }

  private async completeLogin(
    tenantId: string,
    user: {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      userRoles: Array<{ role: { name: string; permissions: unknown } }>;
    },
    context: RequestAuditContext,
  ) {
    const { roles, permissions } = this.extractRolesAndPermissions(user.userRoles);

    const payload: JwtUser = {
      sub: user.id,
      tenantId,
      email: user.email,
      roles,
      permissions,
    };

    const accessToken = jwt.sign(payload, env.JWT_ACCESS_SECRET, {
      expiresIn: env.ACCESS_TOKEN_TTL as jwt.SignOptions['expiresIn'],
    });

    const refreshToken = this.generateRefreshToken();
    const refreshTokenHash = this.hashRefreshToken(refreshToken);
    const refreshExpiry = new Date(
      Date.now() + env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    );

    await prisma.$transaction([
      prisma.refreshToken.create({
        data: {
          tenantId,
          userId: user.id,
          tokenHash: refreshTokenHash,
          expiresAt: refreshExpiry,
          createdByIp: context.ipAddress,
          userAgent: context.userAgent,
        },
      }),
      prisma.user.update({
        where: { id: user.id },
        data: { lastLoginAt: new Date() },
      }),
    ]);

    await this.auditService.log({
      tenantId,
      actorUserId: user.id,
      event: AUDIT_EVENT.AUTH_LOGIN_SUCCESS,
      entity: 'User',
      entityId: user.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
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
    userRoles: Array<{ role: { name: string; permissions: unknown } }>,
  ): { roles: string[]; permissions: string[] } {
    const roles = userRoles.map((item) => item.role.name);
    const permissions = [...
      new Set(
        userRoles.flatMap((item) => normalizePermissions(item.role.permissions)),
      ),
    ];

    return { roles, permissions };
  }
}

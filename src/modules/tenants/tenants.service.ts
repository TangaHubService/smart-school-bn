import { InviteStatus, Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';
import { createHash, randomBytes } from 'crypto';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { env } from '../../config/env';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { buildDefaultTenantRoles } from '../../constants/permissions';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import {
  CreateTenantInput,
  InviteTenantAdminInput,
  ListTenantsQueryInput,
  UpdateTenantInput,
  UpdateTenantStatusInput,
} from './tenants.schemas';

export class TenantsService {
  private readonly auditService = new AuditService();
  private readonly emailService = new EmailService();

  async listTenants(input: ListTenantsQueryInput, _actor: JwtUser) {
    const where: Prisma.TenantWhereInput = {
      code: { not: 'platform' },
    };

    if (input.search) {
      where.OR = [
        {
          code: {
            contains: input.search,
            mode: 'insensitive',
          },
        },
        {
          name: {
            contains: input.search,
            mode: 'insensitive',
          },
        },
        {
          school: {
            displayName: {
              contains: input.search,
              mode: 'insensitive',
            },
          },
        },
      ];
    }

    const skip = (input.page - 1) * input.pageSize;

    const [totalItems, items] = await prisma.$transaction([
      prisma.tenant.count({ where }),
      prisma.tenant.findMany({
        where,
        skip,
        take: input.pageSize,
        include: {
          school: {
            select: {
              id: true,
              displayName: true,
              city: true,
              district: true,
              country: true,
              setupCompletedAt: true,
            },
          },
          users: {
            where: { deletedAt: null },
            select: { id: true },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
      }),
    ]);

    return {
      items: items.map((tenant) => ({
        id: tenant.id,
        code: tenant.code,
        name: tenant.name,
        domain: tenant.domain,
        isActive: tenant.isActive,
        createdAt: tenant.createdAt,
        school: tenant.school,
        activeUsers: tenant.users.length,
      })),
      pagination: buildPagination(input.page, input.pageSize, totalItems),
    };
  }

  async createTenant(
    input: CreateTenantInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    try {
      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            code: input.code,
            name: input.name,
            domain: input.domain,
          },
        });

        const school = await tx.school.create({
          data: {
            tenantId: tenant.id,
            displayName: input.school?.displayName ?? input.name,
            registrationNumber: input.school?.registrationNumber,
            email: input.school?.email,
            phone: input.school?.phone,
            addressLine1: input.school?.addressLine1,
            addressLine2: input.school?.addressLine2,
            province: input.school?.province,
            city: input.school?.city,
            district: input.school?.district,
            sector: input.school?.sector,
            cell: input.school?.cell,
            village: input.school?.village,
            country: input.school?.country ?? 'Rwanda',
            timezone: input.school?.timezone ?? 'Africa/Kigali',
          },
        });

        const roles = [] as { id: string; name: string }[];
        for (const definition of buildDefaultTenantRoles()) {
          const role = await tx.role.create({
            data: {
              tenantId: tenant.id,
              name: definition.name,
              description: definition.description,
              isSystem: definition.isSystem,
              permissions: definition.permissions,
            },
          });

          roles.push({ id: role.id, name: role.name });
        }

        const schoolAdminRole = roles.find((role) => role.name === 'SCHOOL_ADMIN');
        if (!schoolAdminRole) {
          throw new AppError(
            500,
            'TENANT_ROLE_BOOTSTRAP_FAILED',
            'SCHOOL_ADMIN role was not created',
          );
        }

        let schoolAdminUser: {
          id: string;
          email: string;
          firstName: string;
          lastName: string;
        } | null = null;

        if (input.schoolAdmin) {
          const schoolAdminPasswordHash = await bcrypt.hash(
            input.schoolAdmin.password,
            env.BCRYPT_ROUNDS,
          );

          const createdSchoolAdminUser = await tx.user.create({
            data: {
              tenantId: tenant.id,
              email: input.schoolAdmin.email,
              passwordHash: schoolAdminPasswordHash,
              firstName: input.schoolAdmin.firstName,
              lastName: input.schoolAdmin.lastName,
            },
          });

          await tx.userRole.create({
            data: {
              tenantId: tenant.id,
              userId: createdSchoolAdminUser.id,
              roleId: schoolAdminRole.id,
              assignedById: actor.sub,
            },
          });

          schoolAdminUser = {
            id: createdSchoolAdminUser.id,
            email: createdSchoolAdminUser.email,
            firstName: createdSchoolAdminUser.firstName,
            lastName: createdSchoolAdminUser.lastName,
          };
        }

        return {
          tenant,
          school,
          schoolAdminUser,
        };
      });

      await this.auditService.log({
        tenantId: result.tenant.id,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.TENANT_CREATED,
        entity: 'Tenant',
        entityId: result.tenant.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          code: result.tenant.code,
          schoolAdminEmail: result.schoolAdminUser?.email ?? null,
        },
      });

      return {
        tenant: {
          id: result.tenant.id,
          code: result.tenant.code,
          name: result.tenant.name,
          domain: result.tenant.domain,
        },
        school: {
          id: result.school.id,
          displayName: result.school.displayName,
        },
        schoolAdmin: result.schoolAdminUser,
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          409,
          'TENANT_ALREADY_EXISTS',
          'Tenant code/domain or school admin email already exists',
          error.meta,
        );
      }

      throw error;
    }
  }

  async getTenant(tenantId: string, _actor: JwtUser) {
    const tenant = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        code: { not: 'platform' },
      },
      include: {
        school: true,
        users: {
          where: {
            deletedAt: null,
          },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
          },
        },
        invites: {
          where: {
            status: InviteStatus.PENDING,
          },
          include: {
            role: {
              select: {
                name: true,
              },
            },
          },
          orderBy: {
            createdAt: 'desc',
          },
          take: 5,
        },
      },
    });

    if (!tenant) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'School not found');
    }

    return {
      id: tenant.id,
      code: tenant.code,
      name: tenant.name,
      domain: tenant.domain,
      isActive: tenant.isActive,
      createdAt: tenant.createdAt,
      updatedAt: tenant.updatedAt,
      school: tenant.school,
      activeUsers: tenant.users.length,
      pendingInvites: tenant.invites.map((invite) => ({
        id: invite.id,
        email: invite.email,
        roleName: invite.role.name,
        expiresAt: invite.expiresAt,
      })),
      users: tenant.users,
    };
  }

  async inviteSchoolAdmin(
    tenantId: string,
    input: InviteTenantAdminInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: {
        id: true,
        code: true,
        name: true,
        school: {
          select: {
            displayName: true,
          },
        },
        roles: {
          where: {
            name: 'SCHOOL_ADMIN',
          },
          select: {
            id: true,
            name: true,
          },
          take: 1,
        },
      },
    });

    if (!tenant || tenant.code === 'platform') {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'School not found');
    }

    const schoolAdminRole = tenant.roles[0];

    if (!schoolAdminRole) {
      throw new AppError(
        500,
        'TENANT_ROLE_BOOTSTRAP_FAILED',
        'SCHOOL_ADMIN role was not created',
      );
    }

    const rawToken = randomBytes(48).toString('hex');
    const tokenHash = this.hashInviteToken(rawToken);
    const expiresAt = new Date(
      Date.now() + input.expiresInDays * 24 * 60 * 60 * 1000,
    );
    const inviteLink = `${env.APP_WEB_URL.replace(/\/$/, '')}/accept-invite?token=${rawToken}`;

    let createdInviteId = '';

    try {
      const invite = await prisma.$transaction(async (tx) => {
        await tx.invite.deleteMany({
          where: {
            tenantId,
            email: input.email,
            roleId: schoolAdminRole.id,
            status: InviteStatus.PENDING,
          },
        });

        return tx.invite.create({
          data: {
            tenantId,
            email: input.email,
            roleId: schoolAdminRole.id,
            tokenHash,
            status: InviteStatus.PENDING,
            invitedByUserId: actor.sub,
            expiresAt,
          },
        });
      });

      createdInviteId = invite.id;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(409, 'INVITE_ALREADY_EXISTS', 'Pending invite already exists');
      }

      throw error;
    }

    try {
      await this.emailService.sendStaffInvite({
        toEmail: input.email,
        roleName: schoolAdminRole.name,
        tenantName: tenant.school?.displayName ?? tenant.name,
        inviteLink,
        expiresAt,
      });
    } catch (_error) {
      if (createdInviteId) {
        await prisma.invite.update({
          where: { id: createdInviteId },
          data: {
            status: InviteStatus.REVOKED,
            revokedAt: new Date(),
          },
        });
      }

      throw new AppError(
        502,
        'INVITE_EMAIL_FAILED',
        'Failed to send invite email. Check SMTP settings and retry.',
      );
    }

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.STAFF_INVITE_CREATED,
      entity: 'Invite',
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        email: input.email,
        roleName: schoolAdminRole.name,
        expiresAt,
      },
    });

    return {
      tenant: {
        id: tenant.id,
        code: tenant.code,
        name: tenant.name,
      },
      email: input.email,
      roleName: schoolAdminRole.name,
      expiresAt,
      emailSent: true,
    };
  }

  async updateTenant(
    tenantId: string,
    input: UpdateTenantInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const existing = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        code: { not: 'platform' },
      },
      include: {
        school: true,
      },
    });

    if (!existing) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'School not found');
    }

    try {
      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.update({
          where: { id: tenantId },
          data: {
            code: input.code,
            name: input.name,
            domain: input.domain || null,
          },
        });

        const school = await tx.school.upsert({
          where: { tenantId },
          update: {
            displayName: input.school.displayName,
            email: input.school.email || null,
            phone: input.school.phone || null,
          },
          create: {
            tenantId,
            displayName: input.school.displayName,
            email: input.school.email || null,
            phone: input.school.phone || null,
            country: 'Rwanda',
            timezone: 'Africa/Kigali',
          },
        });

        return { tenant, school };
      });

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.TENANT_UPDATED,
        entity: 'Tenant',
        entityId: tenantId,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          before: {
            code: existing.code,
            name: existing.name,
            domain: existing.domain,
            schoolDisplayName: existing.school?.displayName ?? null,
          },
          after: {
            code: result.tenant.code,
            name: result.tenant.name,
            domain: result.tenant.domain,
            schoolDisplayName: result.school.displayName,
          },
        },
      });

      return {
        id: result.tenant.id,
        code: result.tenant.code,
        name: result.tenant.name,
        domain: result.tenant.domain,
        isActive: result.tenant.isActive,
        school: {
          id: result.school.id,
          displayName: result.school.displayName,
          email: result.school.email,
          phone: result.school.phone,
        },
      };
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new AppError(
          409,
          'TENANT_ALREADY_EXISTS',
          'School code or domain already exists',
          error.meta,
        );
      }

      throw error;
    }
  }

  async deactivateTenant(
    tenantId: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    return this.updateTenantStatus(
      tenantId,
      { isActive: false },
      actor,
      context,
    );
  }

  async updateTenantStatus(
    tenantId: string,
    input: UpdateTenantStatusInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const existing = await prisma.tenant.findFirst({
      where: {
        id: tenantId,
        code: { not: 'platform' },
      },
    });

    if (!existing) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'School not found');
    }

    if (existing.isActive === input.isActive) {
      return {
        id: existing.id,
        code: existing.code,
        name: existing.name,
        isActive: existing.isActive,
      };
    }

    const result = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.update({
        where: { id: tenantId },
        data: {
          isActive: input.isActive,
        },
      });

      if (!input.isActive) {
        await tx.refreshToken.updateMany({
          where: {
            tenantId,
            revokedAt: null,
          },
          data: {
            revokedAt: new Date(),
          },
        });

        await tx.invite.updateMany({
          where: {
            tenantId,
            status: InviteStatus.PENDING,
          },
          data: {
            status: InviteStatus.REVOKED,
            revokedAt: new Date(),
          },
        });
      }

      return tenant;
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: input.isActive ? AUDIT_EVENT.TENANT_ACTIVATED : AUDIT_EVENT.TENANT_DEACTIVATED,
      entity: 'Tenant',
      entityId: tenantId,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        code: result.code,
        name: result.name,
        isActive: result.isActive,
      },
    });

    return {
      id: result.id,
      code: result.code,
      name: result.name,
      isActive: result.isActive,
    };
  }

  private hashInviteToken(token: string): string {
    return createHash('sha256')
      .update(`${token}:${env.JWT_REFRESH_SECRET}`)
      .digest('hex');
  }
}

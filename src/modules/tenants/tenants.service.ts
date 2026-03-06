import { Prisma } from '@prisma/client';
import bcrypt from 'bcrypt';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { env } from '../../config/env';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { buildDefaultTenantRoles } from '../../constants/permissions';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { CreateTenantInput, ListTenantsQueryInput } from './tenants.schemas';

export class TenantsService {
  private readonly auditService = new AuditService();

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
            displayName: input.school.displayName,
            registrationNumber: input.school.registrationNumber,
            email: input.school.email,
            phone: input.school.phone,
            addressLine1: input.school.addressLine1,
            city: input.school.city,
            district: input.school.district,
            country: input.school.country,
            timezone: input.school.timezone,
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

        const schoolAdminPasswordHash = await bcrypt.hash(
          input.schoolAdmin.password,
          env.BCRYPT_ROUNDS,
        );

        const schoolAdminUser = await tx.user.create({
          data: {
            tenantId: tenant.id,
            email: input.schoolAdmin.email,
            passwordHash: schoolAdminPasswordHash,
            firstName: input.schoolAdmin.firstName,
            lastName: input.schoolAdmin.lastName,
          },
        });

        const schoolAdminRole = roles.find((role) => role.name === 'SCHOOL_ADMIN');
        if (!schoolAdminRole) {
          throw new AppError(
            500,
            'TENANT_ROLE_BOOTSTRAP_FAILED',
            'SCHOOL_ADMIN role was not created',
          );
        }

        await tx.userRole.create({
          data: {
            tenantId: tenant.id,
            userId: schoolAdminUser.id,
            roleId: schoolAdminRole.id,
            assignedById: actor.sub,
          },
        });

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
          schoolAdminEmail: result.schoolAdminUser.email,
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
        schoolAdmin: {
          id: result.schoolAdminUser.id,
          email: result.schoolAdminUser.email,
          firstName: result.schoolAdminUser.firstName,
          lastName: result.schoolAdminUser.lastName,
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
          'Tenant code/domain or school admin email already exists',
          error.meta,
        );
      }

      throw error;
    }
  }
}

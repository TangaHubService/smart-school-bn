import { Prisma, UserStatus } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { normalizePermissions } from '../../common/utils/permission-utils';
import { buildPagination } from '../../common/utils/pagination';
import { prisma } from '../../db/prisma';
import { ListUsersQueryInput } from './users.schemas';

export class UsersService {
  async getMe(currentUser: JwtUser) {
    const user = await prisma.user.findUnique({
      where: { id: currentUser.sub },
      include: {
        tenant: {
          include: {
            school: true,
          },
        },
        userRoles: {
          include: {
            role: true,
          },
        },
        studentProfile: {
          include: {
            enrollments: {
              where: { isActive: true },
              include: {
                academicYear: true,
                classRoom: true,
              },
              take: 1,
              orderBy: { createdAt: 'desc' },
            },
          },
        },
      },
    });

    if (!user || user.deletedAt) {
      throw new AppError(401, 'AUTH_USER_NOT_FOUND', 'User not found');
    }

    const roles = user.userRoles.map((ur) => ur.role.name);
    const permissions = normalizePermissions(user.userRoles.map((ur) => ur.role.permissions).flat());

    const latestEnrollment = user.studentProfile?.enrollments[0] ?? null;

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      tenant: {
        id: user.tenant.id,
        name: user.tenant.name,
        code: user.tenant.code,
        isAcademyCatalog: user.tenant.isAcademyCatalog,
      },
      school: user.tenant.school
        ? {
            id: user.tenant.school.id,
            displayName: user.tenant.school.displayName,
            setupCompletedAt: user.tenant.school.setupCompletedAt,
          }
        : null,
      roles,
      permissions,
      student: user.studentProfile
        ? {
            id: user.studentProfile.id,
            studentCode: user.studentProfile.studentCode,
            firstName: user.studentProfile.firstName,
            lastName: user.studentProfile.lastName,
            currentEnrollment: latestEnrollment
              ? {
                  id: latestEnrollment.id,
                  academicYear: {
                    id: latestEnrollment.academicYear.id,
                    name: latestEnrollment.academicYear.name,
                  },
                  classRoom: {
                    id: latestEnrollment.classRoom.id,
                    code: latestEnrollment.classRoom.code,
                    name: latestEnrollment.classRoom.name,
                  },
                }
              : null,
          }
        : null,
    };
  }

  private buildListWhere(currentUser: JwtUser, input: ListUsersQueryInput): Prisma.UserWhereInput {
    const isSuperAdmin = currentUser.roles.includes('SUPER_ADMIN');
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
    };

    if (!isSuperAdmin) {
      where.tenantId = currentUser.tenantId;
      where.NOT = {
        userRoles: {
          some: {
            role: { name: 'SUPER_ADMIN' },
          },
        },
      };
    } else if (input.tenantId) {
      where.tenantId = input.tenantId;
    }

    if (input.role) {
      where.userRoles = {
        some: {
          role: {
            name: input.role,
          },
        },
      };
    }

    if (input.status && input.status !== 'all') {
      where.status = input.status === 'active' ? 'ACTIVE' : 'INACTIVE';
    }

    if (input.search) {
      const search = input.search.toLowerCase();
      where.OR = [
        { firstName: { contains: search, mode: 'insensitive' } },
        { lastName: { contains: search, mode: 'insensitive' } },
        { email: { contains: search, mode: 'insensitive' } },
        { phone: { contains: search, mode: 'insensitive' } },
      ];
    }

    if (input.createdFrom || input.createdTo) {
      where.createdAt = {};
      if (input.createdFrom) {
        where.createdAt.gte = new Date(input.createdFrom);
      }
      if (input.createdTo) {
        where.createdAt.lte = new Date(input.createdTo);
      }
    }

    return where;
  }

  async listUsers(currentUser: JwtUser, input: ListUsersQueryInput) {
    const where = this.buildListWhere(currentUser, input);
    const page = input.page ?? 1;
    const pageSize = input.pageSize ?? 50;

    const [
      totalRaw,
      users,
      superAdmins,
      schoolAdmins,
      teachers,
      students,
      parents,
    ] = await prisma.$transaction([
      prisma.user.count({ where }),
      prisma.user.findMany({
        where,
        include: {
          tenant: true,
          userRoles: {
            include: {
              role: true,
            },
          },
        },
        orderBy: {
          createdAt: 'desc',
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      prisma.user.count({
        where: {
          ...where,
          userRoles: { some: { role: { name: 'SUPER_ADMIN' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...where,
          userRoles: { some: { role: { name: 'SCHOOL_ADMIN' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...where,
          userRoles: { some: { role: { name: 'TEACHER' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...where,
          userRoles: { some: { role: { name: 'STUDENT' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...where,
          userRoles: { some: { role: { name: 'PARENT' } } },
        },
      }),
    ]);

    return {
      items: users.map((user) => ({
        id: user.id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        phone: user.phone ?? null,
        status: user.status,
        createdAt: user.createdAt.toISOString(),
        tenant: user.tenant
          ? {
              id: user.tenant.id,
              name: user.tenant.name,
              code: user.tenant.code,
            }
          : null,
        roles: user.userRoles.map((item) => item.role.name),
      })),
      metrics: {
        total: totalRaw,
        superAdmins,
        schoolAdmins,
        teachers,
        students,
        parents,
      },
      pagination: buildPagination(page, pageSize, totalRaw),
    };
  }

  async getUserById(currentUser: JwtUser, userId: string) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      include: {
        tenant: true,
        userRoles: {
          include: { role: true },
        },
      },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const isSuperAdmin = currentUser.roles.includes('SUPER_ADMIN');
    if (!isSuperAdmin && user.tenantId !== currentUser.tenantId) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot access this user');
    }
    if (!isSuperAdmin && user.userRoles.some((ur) => ur.role.name === 'SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot access this user');
    }

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      phone: user.phone ?? null,
      status: user.status,
      createdAt: user.createdAt.toISOString(),
      updatedAt: user.updatedAt.toISOString(),
      lastLoginAt: user.lastLoginAt?.toISOString() ?? null,
      tenant: user.tenant
        ? {
            id: user.tenant.id,
            name: user.tenant.name,
            code: user.tenant.code,
          }
        : null,
      roles: user.userRoles.map((r) => r.role.name),
    };
  }

  async updateUserStatus(currentUser: JwtUser, userId: string, status: UserStatus) {
    const user = await prisma.user.findFirst({
      where: { id: userId, deletedAt: null },
      select: {
        id: true,
        tenantId: true,
        userRoles: {
          select: {
            role: { select: { name: true } },
          },
        },
      },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const isSuperAdmin = currentUser.roles.includes('SUPER_ADMIN');
    if (!isSuperAdmin && user.tenantId !== currentUser.tenantId) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot update this user');
    }
    if (!isSuperAdmin && user.userRoles.some((ur) => ur.role.name === 'SUPER_ADMIN')) {
      throw new AppError(403, 'FORBIDDEN', 'Cannot update this user');
    }

    if (user.id === currentUser.sub && status === 'INACTIVE') {
      throw new AppError(400, 'INVALID_STATUS', 'You cannot deactivate your own account');
    }

    await prisma.user.update({
      where: { id: userId },
      data: { status },
    });

    return { id: userId, status };
  }
}

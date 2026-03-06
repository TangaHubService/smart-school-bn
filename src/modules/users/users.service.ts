import { prisma } from '../../db/prisma';
import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { normalizePermissions } from '../../common/utils/permission-utils';

export class UsersService {
  async getMe(user: JwtUser) {
    const dbUser = await prisma.user.findFirst({
      where: {
        id: user.sub,
        tenantId: user.tenantId,
        deletedAt: null,
      },
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
      },
    });

    if (!dbUser) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    const roles = dbUser.userRoles.map((item) => item.role.name);
    const permissions = [
      ...new Set(
        dbUser.userRoles.flatMap((item) =>
          normalizePermissions(item.role.permissions),
        ),
      ),
    ];

    return {
      id: dbUser.id,
      tenant: {
        id: dbUser.tenant.id,
        code: dbUser.tenant.code,
        name: dbUser.tenant.name,
      },
      school: dbUser.tenant.school
        ? {
            id: dbUser.tenant.school.id,
            displayName: dbUser.tenant.school.displayName,
            setupCompletedAt: dbUser.tenant.school.setupCompletedAt,
          }
        : null,
      email: dbUser.email,
      firstName: dbUser.firstName,
      lastName: dbUser.lastName,
      roles,
      permissions,
    };
  }
}

import { Prisma, GovScopeLevel } from '@prisma/client';
import bcrypt from 'bcrypt';
import { z } from 'zod';

import { prisma } from '../../db/prisma';
import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { env } from '../../config/env';
import { GOV_AUDITOR_PERMISSIONS } from '../../constants/permissions';
import {
  getProvinces,
  getDistricts,
  getSectors,
  normalizeProvince,
  normalizeDistrict,
  normalizeSector,
} from '../../utils/rwanda-locations';
import {
  assignAuditorSchema,
  createAuditorUserSchema,
  listAuditorsQuerySchema,
  type CreateAuditorUserInput,
  type ListAuditorsQueryInput,
} from './admin-auditors.schemas';

type AssignAuditorInputType = z.infer<typeof assignAuditorSchema>;

type AuditorScope = {
  level: 'NATIONAL' | 'PROVINCE' | 'DISTRICT' | 'SECTOR';
  country: string;
  province: string | null;
  district: string | null;
  sector: string | null;
};

export class AdminAuditorsService {
  async getLocations(province?: string, district?: string) {
    if (!province) {
      return {
        provinces: getProvinces(),
      };
    }

    if (!district) {
      const normalizedProvince = normalizeProvince(province);
      if (!normalizedProvince) {
        throw new AppError(400, 'INVALID_PROVINCE', 'Invalid province name');
      }
      return {
        provinces: getProvinces(),
        districts: getDistricts(normalizedProvince),
      };
    }

    const normalizedProvince = normalizeProvince(province);
    const normalizedDistrict = normalizeDistrict(province, district);

    if (!normalizedProvince) {
      throw new AppError(400, 'INVALID_PROVINCE', 'Invalid province name');
    }
    if (!normalizedDistrict) {
      throw new AppError(400, 'INVALID_DISTRICT', 'Invalid district name');
    }

    return {
      provinces: getProvinces(),
      districts: getDistricts(normalizedProvince),
      sectors: getSectors(normalizedProvince, normalizedDistrict),
    };
  }

  async listAuditors(query: ListAuditorsQueryInput, _user: JwtUser) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;

    const where: Prisma.AuditorWhereInput = {};

    if (query.level) {
      where.level = query.level;
    }

    if (query.search) {
      where.user = {
        OR: [
          { firstName: { contains: query.search, mode: 'insensitive' } },
          { lastName: { contains: query.search, mode: 'insensitive' } },
          { email: { contains: query.search, mode: 'insensitive' } },
        ],
      };
    }

    const [total, auditors] = await Promise.all([
      prisma.auditor.count({ where }),
      prisma.auditor.findMany({
        where,
        include: {
          user: {
            select: {
              id: true,
              email: true,
              firstName: true,
              lastName: true,
              status: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: auditors.map(a => ({
        id: a.id,
        userId: a.userId,
        email: a.user.email,
        firstName: a.user.firstName,
        lastName: a.user.lastName,
        status: a.user.status,
        level: a.level,
        country: a.country,
        province: a.province,
        district: a.district,
        sector: a.sector,
        isActive: a.isActive,
        createdAt: a.createdAt.toISOString(),
      })),
      pagination: {
        page,
        pageSize,
        total,
        totalPages: Math.ceil(total / pageSize),
      },
    };
  }

  async getAuditorById(auditorId: string, _user: JwtUser) {
    const auditor = await prisma.auditor.findUnique({
      where: { id: auditorId },
      include: {
        user: {
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            status: true,
            createdAt: true,
          },
        },
      },
    });

    if (!auditor) {
      throw new AppError(404, 'AUDITOR_NOT_FOUND', 'Auditor not found');
    }

    return {
      id: auditor.id,
      userId: auditor.userId,
      email: auditor.user.email,
      firstName: auditor.user.firstName,
      lastName: auditor.user.lastName,
      status: auditor.user.status,
      level: auditor.level,
      country: auditor.country,
      province: auditor.province,
      district: auditor.district,
      sector: auditor.sector,
      isActive: auditor.isActive,
      createdAt: auditor.createdAt.toISOString(),
    };
  }

  async assignAuditorScope(userId: string, input: AssignAuditorInputType, assignedByUser: JwtUser) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      include: {
        tenant: {
          select: {
            code: true,
          },
        },
      },
    });

    if (!user) {
      throw new AppError(404, 'USER_NOT_FOUND', 'User not found');
    }

    if (user.tenant.code !== 'platform') {
      throw new AppError(400, 'INVALID_AUDITOR_USER', 'Auditors must be platform users');
    }

    const scope = this.normalizeAuditorScope(input);

    const auditor = await prisma.$transaction(async tx => {
      await this.ensureGovAuditorRole(tx, user.tenantId, user.id, assignedByUser.sub);

      const existingAuditor = await tx.auditor.findUnique({
        where: { userId },
      });

      const savedAuditor = existingAuditor
        ? await tx.auditor.update({
            where: { id: existingAuditor.id },
            data: {
              level: input.level,
              province: scope.province,
              district: scope.district,
              sector: scope.sector,
              isActive: true,
            },
          })
        : await tx.auditor.create({
            data: {
              userId,
              level: input.level,
              country: 'Rwanda',
              province: scope.province,
              district: scope.district,
              sector: scope.sector,
              isActive: true,
            },
          });

      await tx.govAuditorScope.updateMany({
        where: { auditorUserId: userId, isActive: true },
        data: { isActive: false },
      });

      await tx.govAuditorScope.create({
        data: {
          auditorUserId: userId,
          assignedByUserId: assignedByUser.sub,
          scopeLevel: this.mapLevelToScopeLevel(input.level),
          country: 'Rwanda',
          province: scope.province,
          district: scope.district,
          sector: scope.sector,
          notes: input.notes,
          isActive: true,
        },
      });

      return savedAuditor;
    });

    return {
      id: auditor.id,
      userId: auditor.userId,
      level: auditor.level,
      country: auditor.country,
      province: auditor.province,
      district: auditor.district,
      sector: auditor.sector,
      isActive: auditor.isActive,
    };
  }

  async removeAuditorScope(auditorId: string, _user: JwtUser) {
    const auditor = await prisma.auditor.findUnique({
      where: { id: auditorId },
    });

    if (!auditor) {
      throw new AppError(404, 'AUDITOR_NOT_FOUND', 'Auditor not found');
    }

    await prisma.govAuditorScope.updateMany({
      where: { auditorUserId: auditor.userId, isActive: true },
      data: { isActive: false },
    });

    await prisma.auditor.update({
      where: { id: auditorId },
      data: {
        level: 'NATIONAL',
        province: null,
        district: null,
        sector: null,
        isActive: false,
      },
    });

    return { message: 'Auditor scope removed successfully' };
  }

  async createAuditorUser(input: CreateAuditorUserInput, assignedByUser: JwtUser) {
    const existingUser = await prisma.user.findFirst({
      where: {
        email: input.email.toLowerCase(),
        tenant: { code: 'platform' },
        deletedAt: null,
      },
    });

    if (existingUser) {
      throw new AppError(400, 'USER_EXISTS', 'User with this email already exists');
    }

    const tenant = await prisma.tenant.findUnique({
      where: { code: 'platform' },
    });

    if (!tenant) {
      throw new AppError(500, 'TENANT_NOT_FOUND', 'Platform tenant not found');
    }

    const scope = this.normalizeAuditorScope(input);
    const passwordHash = await bcrypt.hash(input.password, env.BCRYPT_ROUNDS);

    const user = await prisma.$transaction(async tx => {
      const createdUser = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: input.email.toLowerCase(),
          firstName: input.firstName,
          lastName: input.lastName,
          phone: input.phone?.trim() || null,
          passwordHash,
          status: 'ACTIVE',
        },
      });

      await this.ensureGovAuditorRole(tx, tenant.id, createdUser.id, assignedByUser.sub);

      await tx.auditor.create({
        data: {
          userId: createdUser.id,
          level: input.level,
          country: 'Rwanda',
          province: scope.province,
          district: scope.district,
          sector: scope.sector,
          isActive: true,
        },
      });

      await tx.govAuditorScope.create({
        data: {
          auditorUserId: createdUser.id,
          assignedByUserId: assignedByUser.sub,
          scopeLevel: this.mapLevelToScopeLevel(input.level),
          country: 'Rwanda',
          province: scope.province,
          district: scope.district,
          sector: scope.sector,
          notes: input.notes,
          isActive: true,
        },
      });

      return createdUser;
    });

    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
  }

  async searchUsers(query: string, _user: JwtUser) {
    const users = await prisma.user.findMany({
      where: {
        tenant: {
          code: 'platform',
        },
        OR: [
          { email: { contains: query, mode: 'insensitive' } },
          { firstName: { contains: query, mode: 'insensitive' } },
          { lastName: { contains: query, mode: 'insensitive' } },
        ],
        deletedAt: null,
        status: 'ACTIVE',
      },
      select: {
        id: true,
        email: true,
        firstName: true,
        lastName: true,
      },
      take: 20,
    });

    return users;
  }

  private normalizeAuditorScope(input: {
    level: AssignAuditorInputType['level'];
    province?: string;
    district?: string;
    sector?: string;
  }) {
    if (input.level === 'NATIONAL') {
      return {
        province: null,
        district: null,
        sector: null,
      };
    }

    const province = input.province ? normalizeProvince(input.province) : null;
    if (!province) {
      throw new AppError(400, 'INVALID_PROVINCE', 'Invalid province name');
    }

    if (input.level === 'PROVINCE') {
      return {
        province,
        district: null,
        sector: null,
      };
    }

    const district = input.district ? normalizeDistrict(province, input.district) : null;
    if (!district) {
      throw new AppError(400, 'INVALID_DISTRICT', 'Invalid district name');
    }

    if (input.level === 'DISTRICT') {
      return {
        province,
        district,
        sector: null,
      };
    }

    const sector = input.sector ? normalizeSector(province, district, input.sector) : null;
    if (!sector) {
      throw new AppError(400, 'INVALID_SECTOR', 'Invalid sector name');
    }

    return {
      province,
      district,
      sector,
    };
  }

  async getMyScope(user: JwtUser) {
    const auditor = await prisma.auditor.findUnique({
      where: { userId: user.sub },
    });
    if (!auditor || !auditor.isActive) {
      throw new AppError(403, 'AUDITOR_NOT_ACTIVE', 'No active auditor scope found');
    }
    return {
      level: auditor.level,
      country: auditor.country,
      province: auditor.province,
      district: auditor.district,
      sector: auditor.sector,
      isActive: auditor.isActive,
    };
  }

  async getAuditorReport(user: JwtUser) {
    const auditor = await prisma.auditor.findUnique({
      where: { userId: user.sub },
    });
    if (!auditor || !auditor.isActive) {
      throw new AppError(403, 'AUDITOR_NOT_ACTIVE', 'No active auditor scope found');
    }

    const scope: AuditorScope = {
      level: auditor.level as AuditorScope['level'],
      country: auditor.country,
      province: auditor.province,
      district: auditor.district,
      sector: auditor.sector,
    };

    const schools = await prisma.school.findMany({
      where: this.buildSchoolWhereFromScope(scope),
      select: { id: true, displayName: true, province: true, district: true, sector: true },
    });
    const schoolIds = schools.map(s => s.id);

    const audits = await prisma.academicAudit.findMany({
      where: { schoolId: { in: schoolIds } },
      include: {
        school: { select: { displayName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const moduleDistribution: Record<string, number> = {};
    let totalScore = 0;
    const auditedSchoolIds = new Set<string>();
    for (const a of audits) {
      moduleDistribution[a.module] = (moduleDistribution[a.module] || 0) + 1;
      totalScore += a.score;
      auditedSchoolIds.add(a.schoolId);
    }

    return {
      scope,
      report: {
        totalSchoolsInScope: schoolIds.length,
        schoolsAudited: auditedSchoolIds.size,
        pendingSchools: schoolIds.length - auditedSchoolIds.size,
        totalAudits: audits.length,
        averageScore: audits.length > 0 ? Math.round(totalScore / audits.length) : null,
        moduleDistribution,
        schools: schools.map(s => ({
          id: s.id,
          name: s.displayName,
          province: s.province,
          district: s.district,
          sector: s.sector,
          auditCount: audits.filter(a => a.schoolId === s.id).length,
          latestScore: audits.filter(a => a.schoolId === s.id).sort((a, b) =>
            new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
          )[0]?.score ?? null,
        })),
        recentAudits: audits.slice(0, 10).map(a => ({
          id: a.id,
          school: a.school.displayName,
          module: a.module,
          score: a.score,
          status: a.status,
          createdAt: a.createdAt.toISOString(),
        })),
      },
    };
  }

  private buildSchoolWhereFromScope(scope: AuditorScope): Prisma.SchoolWhereInput {
    const where: Prisma.SchoolWhereInput = {
      country: scope.country,
    };
    if (scope.sector) {
      where.district = scope.district;
      where.sector = scope.sector;
      return where;
    }
    if (scope.district) {
      where.district = scope.district;
      return where;
    }
    if (scope.province) {
      where.province = scope.province;
    }
    return where;
  }

  private async ensureGovAuditorRole(
    tx: Prisma.TransactionClient,
    tenantId: string,
    userId: string,
    assignedById?: string
  ) {
    let role = await tx.role.findUnique({
      where: {
        tenantId_name: {
          tenantId,
          name: 'GOV_AUDITOR',
        },
      },
    });

    if (!role) {
      role = await tx.role.create({
        data: {
          tenantId,
          name: 'GOV_AUDITOR',
          description: 'Government auditor role',
          isSystem: true,
          permissions: GOV_AUDITOR_PERMISSIONS,
        },
      });
    }

    await tx.userRole.upsert({
      where: {
        tenantId_userId_roleId: {
          tenantId,
          userId,
          roleId: role.id,
        },
      },
      update: {},
      create: {
        tenantId,
        userId,
        roleId: role.id,
        assignedById,
      },
    });
  }

  private mapLevelToScopeLevel(level: string): GovScopeLevel {
    const mapping: Record<string, GovScopeLevel> = {
      NATIONAL: 'COUNTRY',
      PROVINCE: 'PROVINCE',
      DISTRICT: 'DISTRICT',
      SECTOR: 'SECTOR',
    };
    return mapping[level] || 'COUNTRY';
  }
}

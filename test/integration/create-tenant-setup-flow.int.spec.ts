jest.mock('../../src/db/prisma', () => {
  const prisma = {
    auditLog: { create: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { SchoolsService } from '../../src/modules/schools/schools.service';
import { TenantsService } from '../../src/modules/tenants/tenants.service';

const mockedPrisma = prisma as any;

describe('create tenant -> setup complete flow', () => {
  const tenantsService = new TenantsService();
  const schoolsService = new SchoolsService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
  });

  it('creates tenant and completes setup wizard in sequence', async () => {
    mockedPrisma.$transaction
      .mockImplementationOnce(async (callback: any) => {
        const tx = {
          tenant: {
            create: jest.fn().mockResolvedValue({
              id: 'tenant-1',
              code: 'new-school',
              name: 'New School',
              domain: 'new-school.local',
            }),
          },
          school: {
            create: jest.fn().mockResolvedValue({ id: 'school-1', displayName: 'New School' }),
          },
          role: {
            create: jest
              .fn()
              .mockResolvedValueOnce({ id: 'role-admin', name: 'SCHOOL_ADMIN' })
              .mockResolvedValueOnce({ id: 'role-teacher', name: 'TEACHER' })
              .mockResolvedValueOnce({ id: 'role-parent', name: 'PARENT' }),
          },
          user: {
            create: jest.fn().mockResolvedValue({
              id: 'admin-1',
              email: 'admin@newschool.rw',
              firstName: 'Alice',
              lastName: 'Admin',
            }),
          },
          userRole: {
            create: jest.fn().mockResolvedValue({ id: 'user-role-1' }),
          },
        };

        return callback(tx);
      })
      .mockImplementationOnce(async (callback: any) => {
        const tx = {
          school: {
            upsert: jest.fn().mockResolvedValue({
              id: 'school-1',
              displayName: 'New School',
              setupCompletedAt: new Date(),
            }),
          },
          academicYear: {
            updateMany: jest.fn().mockResolvedValue({ count: 0 }),
            upsert: jest.fn().mockResolvedValue({ id: 'year-1' }),
          },
          term: {
            upsert: jest.fn().mockResolvedValue({ id: 'term-1' }),
          },
          gradeLevel: {
            upsert: jest.fn().mockResolvedValue({ id: 'grade-1' }),
          },
          classRoom: {
            upsert: jest.fn().mockResolvedValue({ id: 'class-1' }),
          },
          subject: {
            upsert: jest.fn().mockResolvedValue({ id: 'subject-1' }),
          },
        };

        return callback(tx);
      });

    const tenantResult = await tenantsService.createTenant(
      {
        code: 'new-school',
        name: 'New School',
        domain: 'new-school.local',
        school: {
          displayName: 'New School',
          country: 'Rwanda',
          timezone: 'Africa/Kigali',
        },
        schoolAdmin: {
          email: 'admin@newschool.rw',
          firstName: 'Alice',
          lastName: 'Admin',
          password: 'StrongPass123!',
        },
      },
      {
        sub: 'super-1',
        tenantId: 'platform',
        email: 'superadmin@smartschool.rw',
        roles: ['SUPER_ADMIN'],
        permissions: ['tenants.create'],
      },
      {
        requestId: 'req-1',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    const setupResult = await schoolsService.completeSetup(
      tenantResult.tenant.id,
      {
        school: {
          displayName: 'New School',
          country: 'Rwanda',
          timezone: 'Africa/Kigali',
        },
        academicYear: {
          name: '2026/2027',
          startDate: '2026-09-01',
          endDate: '2027-07-15',
          isCurrent: true,
          terms: [
            {
              name: 'Term 1',
              sequence: 1,
              startDate: '2026-09-01',
              endDate: '2026-12-15',
            },
          ],
        },
        gradeLevels: [
          {
            code: 'G1',
            name: 'Grade 1',
            rank: 1,
            classes: [{ code: 'G1-A', name: 'Grade 1 A', capacity: 40 }],
          },
        ],
        subjects: [{ code: 'MATH', name: 'Mathematics', isCore: true }],
        markSetupComplete: true,
      },
      {
        sub: 'admin-1',
        tenantId: tenantResult.tenant.id,
        email: 'admin@newschool.rw',
        roles: ['SCHOOL_ADMIN'],
        permissions: ['school.setup.manage'],
      },
      {
        requestId: 'req-2',
        ipAddress: '127.0.0.1',
        userAgent: 'jest',
      },
    );

    expect(tenantResult.tenant.code).toBe('new-school');
    expect(setupResult.summary.createdTerms).toBe(1);
    expect(setupResult.summary.createdClassRooms).toBe(1);
    expect(mockedPrisma.auditLog.create).toHaveBeenCalledTimes(2);
  });
});

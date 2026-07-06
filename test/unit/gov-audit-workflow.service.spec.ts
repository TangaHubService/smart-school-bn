jest.mock('../../src/db/prisma', () => {
  const prisma = {
    academicAudit: {
      findFirst: jest.fn(),
      findUnique: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    school: {
      findFirst: jest.fn(),
      findMany: jest.fn(),
    },
    fileAsset: {
      upsert: jest.fn(),
    },
    user: {
      findMany: jest.fn(),
    },
    auditor: {
      findMany: jest.fn(),
      findUnique: jest.fn(),
    },
    govAuditorScope: {
      findFirst: jest.fn(),
    },
  };
  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { GovService } from '../../src/modules/gov/gov.service';
import { JwtUser } from '../../src/common/types/auth.types';

const mockedPrisma = prisma as unknown as {
  academicAudit: {
    findFirst: jest.Mock;
    findUnique: jest.Mock;
    create: jest.Mock;
    update: jest.Mock;
  };
  school: { findMany: jest.Mock };
};

function actor(overrides: Partial<JwtUser> = {}): JwtUser {
  return {
    sub: 'auditor-1',
    tenantId: 'tenant-1',
    email: 'auditor@example.com',
    roles: ['GOV_AUDITOR'],
    permissions: [],
    ...overrides,
  } as JwtUser;
}

const baseAudit = {
  id: 'audit-1',
  auditorId: 'auditor-1',
  schoolId: 'school-1',
  tenantId: 'tenant-1',
  module: 'FINANCE',
  score: 70,
  comment: 'Some findings',
  recommendation: null,
  status: 'DRAFT',
  reviewNote: null,
};

describe('GovService audit workflow', () => {
  let service: GovService;

  beforeEach(() => {
    jest.clearAllMocks();
    service = new GovService();
    (prisma as any).auditor.findMany.mockResolvedValue([]);
  });

  it('blocks a different auditor from editing someone else\'s draft audit', async () => {
    mockedPrisma.academicAudit.findFirst.mockResolvedValue({ ...baseAudit });

    await expect(
      service.updateAcademicAudit(actor({ sub: 'other-auditor' }), 'audit-1', { score: 90 })
    ).rejects.toMatchObject({ code: 'AUDIT_ACCESS_DENIED', statusCode: 403 });

    expect(mockedPrisma.academicAudit.update).not.toHaveBeenCalled();
  });

  it('blocks editing an audit that has already been submitted', async () => {
    mockedPrisma.academicAudit.findFirst.mockResolvedValue({ ...baseAudit, status: 'SUBMITTED' });

    await expect(service.updateAcademicAudit(actor(), 'audit-1', { score: 90 })).rejects.toMatchObject({
      code: 'AUDIT_NOT_EDITABLE',
      statusCode: 409,
    });
  });

  it('requires findings before a draft can be submitted', async () => {
    mockedPrisma.academicAudit.findFirst.mockResolvedValue({
      ...baseAudit,
      comment: null,
      school: { id: 'school-1', displayName: 'Test School', tenantId: 'tenant-1' },
    });

    await expect(service.submitDraftAudit(actor(), 'audit-1')).rejects.toMatchObject({
      code: 'AUDIT_COMMENT_REQUIRED',
      statusCode: 400,
    });
  });

  it('lets a SUPER_ADMIN approve a submitted audit', async () => {
    mockedPrisma.school.findMany.mockResolvedValue([{ id: 'school-1' }]);
    mockedPrisma.academicAudit.findFirst.mockResolvedValue({ ...baseAudit, status: 'SUBMITTED' });
    mockedPrisma.academicAudit.update.mockResolvedValue({
      ...baseAudit,
      status: 'APPROVED',
    });

    const result = await service.reviewAcademicAudit(
      actor({ sub: 'admin-1', roles: ['SUPER_ADMIN'] }),
      'audit-1',
      { decision: 'APPROVED', reviewNote: 'Looks good' }
    );

    expect(result.status).toBe('APPROVED');
    expect(mockedPrisma.academicAudit.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({ status: 'APPROVED', reviewNote: 'Looks good' }),
      })
    );
  });

  it('blocks reviewing an audit that is not currently submitted', async () => {
    mockedPrisma.school.findMany.mockResolvedValue([{ id: 'school-1' }]);
    mockedPrisma.academicAudit.findFirst.mockResolvedValue({ ...baseAudit, status: 'DRAFT' });

    await expect(
      service.reviewAcademicAudit(actor({ sub: 'admin-1', roles: ['SUPER_ADMIN'] }), 'audit-1', {
        decision: 'APPROVED',
      })
    ).rejects.toMatchObject({ code: 'AUDIT_NOT_UNDER_REVIEW', statusCode: 409 });
  });

  it('lets a SUPER_ADMIN reopen an approved audit back to needs-revision', async () => {
    mockedPrisma.school.findMany.mockResolvedValue([{ id: 'school-1' }]);
    mockedPrisma.academicAudit.findFirst.mockResolvedValue({ ...baseAudit, status: 'APPROVED' });
    mockedPrisma.academicAudit.update.mockResolvedValue({
      ...baseAudit,
      status: 'NEEDS_REVISION',
    });

    const result = await service.reopenAcademicAudit(
      actor({ sub: 'admin-1', roles: ['SUPER_ADMIN'] }),
      'audit-1',
      { reviewNote: 'Please add evidence' }
    );

    expect(result.status).toBe('NEEDS_REVISION');
  });

  it('blocks reopening an audit that is still a draft', async () => {
    mockedPrisma.school.findMany.mockResolvedValue([{ id: 'school-1' }]);
    mockedPrisma.academicAudit.findFirst.mockResolvedValue({ ...baseAudit, status: 'DRAFT' });

    await expect(
      service.reopenAcademicAudit(actor({ sub: 'admin-1', roles: ['SUPER_ADMIN'] }), 'audit-1', {})
    ).rejects.toMatchObject({ code: 'AUDIT_NOT_REOPENABLE', statusCode: 409 });
  });
});

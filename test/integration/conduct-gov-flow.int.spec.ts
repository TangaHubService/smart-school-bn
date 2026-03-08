jest.mock('../../src/db/prisma', () => {
  const prisma = {
    tenant: { findUnique: jest.fn() },
    role: { upsert: jest.fn() },
    user: { findFirst: jest.fn(), create: jest.fn(), findMany: jest.fn() },
    userRole: { create: jest.fn() },
    student: { findFirst: jest.fn() },
    classRoom: { findFirst: jest.fn() },
    term: { findFirst: jest.fn() },
    studentEnrollment: {
      findMany: jest.fn(),
      count: jest.fn(),
    },
    conductIncident: {
      create: jest.fn(),
      findFirst: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findMany: jest.fn(),
      aggregate: jest.fn(),
    },
    conductAction: {
      create: jest.fn(),
      count: jest.fn(),
    },
    conductMark: {
      findUnique: jest.fn(),
      findMany: jest.fn(),
      findFirst: jest.fn(),
      count: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
    },
    conductConfig: {
      upsert: jest.fn(),
    },
    conductFeedback: {
      create: jest.fn(),
      count: jest.fn(),
    },
    govAuditorScope: {
      findMany: jest.fn(),
      findFirst: jest.fn(),
      create: jest.fn(),
      update: jest.fn(),
      count: jest.fn(),
      findUnique: jest.fn(),
    },
    auditLog: { create: jest.fn() },
    school: { count: jest.fn(), findMany: jest.fn(), findFirst: jest.fn() },
    $transaction: jest.fn(),
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { ConductService } from '../../src/modules/conduct/conduct.service';
import { GovService } from '../../src/modules/gov/gov.service';

const mockedPrisma = prisma as any;

const schoolActor = {
  sub: 'school-admin-1',
  tenantId: 'tenant-school',
  email: 'admin@school.rw',
  roles: ['SCHOOL_ADMIN'],
  permissions: [
    'conduct.read',
    'conduct.manage',
    'conduct.resolve',
    'conduct.marks.manage',
    'conduct.marks.lock',
  ],
};

const auditorActor = {
  sub: 'auditor-1',
  tenantId: 'tenant-platform',
  email: 'enga.bertin@gov.rw',
  roles: ['GOV_AUDITOR'],
  permissions: ['gov.dashboard.read', 'gov.schools.read', 'gov.incidents.read', 'gov.feedback.manage'],
};

const outOfScopeAuditor = {
  ...auditorActor,
  sub: 'auditor-2',
  email: 'other@gov.rw',
};

const context = {
  requestId: 'req-1',
  ipAddress: '127.0.0.1',
  userAgent: 'jest',
};

function buildIncidentRecord() {
  return {
    id: 'incident-1',
    tenantId: 'tenant-school',
    studentId: 'student-1',
    termId: 'term-1',
    classRoomId: 'class-1',
    reportedByUserId: 'school-admin-1',
    occurredAt: new Date('2026-03-07T08:00:00.000Z'),
    category: 'Bullying',
    title: 'Bullying on school grounds',
    description: 'A student reported repeated bullying during break time.',
    deductionPoints: 2,
    severity: 'HIGH',
    status: 'OPEN',
    location: 'Playground',
    reporterNotes: 'School-only note',
    resolutionSummary: null,
    resolvedAt: null,
    resolvedByUserId: null,
    createdAt: new Date('2026-03-07T08:05:00.000Z'),
    updatedAt: new Date('2026-03-07T08:05:00.000Z'),
    tenant: {
      id: 'tenant-school',
      code: 'manihira-primary',
      name: 'Manihira Primary',
      school: {
        id: 'school-1',
        displayName: 'Manihira Primary School',
        province: 'Eastern',
        district: 'Kayonza',
        sector: 'Manihira',
        country: 'Rwanda',
      },
    },
    student: {
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: 'FEMALE',
      dateOfBirth: new Date('2014-05-20T00:00:00.000Z'),
      enrollments: [
        {
          id: 'enrollment-1',
          enrolledAt: new Date('2026-01-08T00:00:00.000Z'),
          academicYear: {
            id: 'year-1',
            name: '2026/2027',
          },
          classRoom: {
            id: 'class-1',
            code: 'P5-A',
            name: 'Primary 5 A',
          },
        },
      ],
    },
    classRoom: {
      id: 'class-1',
      code: 'P5-A',
      name: 'Primary 5 A',
    },
    term: {
      id: 'term-1',
      name: 'Term 1',
      sequence: 1,
    },
    reportedByUser: {
      id: 'school-admin-1',
      firstName: 'School',
      lastName: 'Admin',
    },
    resolvedByUser: null,
    actions: [],
    feedback: [
      {
        id: 'feedback-1',
        authorType: 'GOV_AUDITOR',
        body: 'Initial feedback',
        createdAt: new Date('2026-03-07T10:00:00.000Z'),
        updatedAt: new Date('2026-03-07T10:00:00.000Z'),
        authorUser: {
          id: 'auditor-1',
          firstName: 'Enga',
          lastName: 'Bertin',
        },
      },
    ],
  };
}

function buildConductMarkRecord(overrides: Record<string, unknown> = {}) {
  return {
    id: 'mark-1',
    tenantId: 'tenant-school',
    studentId: 'student-1',
    termId: 'term-1',
    score: 18,
    maxScore: 20,
    isLocked: false,
    computedFromIncidents: true,
    overrideReason: null,
    lockedAt: null,
    lockedByUserId: null,
    updatedByUserId: 'school-admin-1',
    createdAt: new Date('2026-03-07T08:10:00.000Z'),
    updatedAt: new Date('2026-03-07T08:10:00.000Z'),
    student: {
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
    },
    term: {
      id: 'term-1',
      name: 'Term 1',
      sequence: 1,
      academicYear: {
        id: 'year-1',
        name: '2026/2027',
      },
    },
    updatedByUser: {
      id: 'school-admin-1',
      firstName: 'School',
      lastName: 'Admin',
    },
    lockedByUser: null,
    ...overrides,
  };
}

function buildGovConductMarkRecord(overrides: Record<string, unknown> = {}) {
  return {
    ...buildConductMarkRecord(),
    tenant: {
      id: 'tenant-school',
      code: 'manihira-primary',
      name: 'Manihira Primary',
      school: {
        id: 'school-1',
        displayName: 'Manihira Primary School',
        province: 'Eastern',
        district: 'Kayonza',
        sector: 'Manihira',
        country: 'Rwanda',
      },
    },
    feedback: [],
    ...overrides,
  };
}

describe('conduct and government oversight flow', () => {
  const conductService = new ConductService();
  const govService = new GovService();

  beforeEach(() => {
    jest.clearAllMocks();
    mockedPrisma.auditLog.create.mockResolvedValue({ id: 1n });
    mockedPrisma.term.findFirst.mockResolvedValue({
      id: 'term-1',
      name: 'Term 1',
      sequence: 1,
      academicYearId: 'year-1',
    });
    mockedPrisma.conductConfig.upsert.mockResolvedValue({
      id: 'config-1',
      tenantId: 'tenant-school',
      method: 'DEDUCT',
      maxScore: 20,
    });
    mockedPrisma.conductIncident.aggregate.mockResolvedValue({
      _sum: { deductionPoints: 2 },
    });
  });

  it('allows school incident creation and in-scope auditor review with feedback', async () => {
    mockedPrisma.student.findFirst.mockResolvedValue({
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: 'FEMALE',
      dateOfBirth: new Date('2014-05-20T00:00:00.000Z'),
      enrollments: [
        {
          id: 'enrollment-1',
          enrolledAt: new Date('2026-01-08T00:00:00.000Z'),
          academicYear: { id: 'year-1', name: '2026/2027' },
          classRoom: { id: 'class-1', code: 'P5-A', name: 'Primary 5 A' },
        },
      ],
    });
    mockedPrisma.conductIncident.create.mockResolvedValue(buildIncidentRecord());

    const created = await conductService.createIncident(
      'tenant-school',
      {
        studentId: 'student-1',
        termId: 'term-1',
        occurredAt: '2026-03-07T08:00:00.000Z',
        category: 'Bullying',
        title: 'Bullying on school grounds',
        description: 'A student reported repeated bullying during break time.',
        deductionPoints: 2,
        severity: 'HIGH',
        reporterNotes: 'School-only note',
      },
      schoolActor as any,
      context,
    );

    expect(created.id).toBe('incident-1');
    expect(created.student.studentCode).toBe('STU-001');
    expect(created.termId).toBe('term-1');

    mockedPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-platform',
    });
    mockedPrisma.govAuditorScope.findMany.mockResolvedValue([
      {
        id: 'scope-1',
        auditorUserId: 'auditor-1',
        scopeLevel: 'SECTOR',
        country: 'Rwanda',
        province: 'Eastern',
        district: 'Kayonza',
        sector: 'Manihira',
        notes: null,
        startsAt: null,
        endsAt: null,
        isActive: true,
        createdAt: new Date('2026-03-06T08:00:00.000Z'),
        updatedAt: new Date('2026-03-06T08:00:00.000Z'),
      },
    ]);
    mockedPrisma.conductIncident.findFirst.mockResolvedValue(buildIncidentRecord());
    mockedPrisma.conductFeedback.create.mockResolvedValue({ id: 'feedback-2' });

    const visible = await govService.getIncidentDetail(auditorActor as any, 'incident-1');
    expect(visible.reporterNotes).toBeNull();
    expect(visible.school?.sector).toBe('Manihira');

    mockedPrisma.conductIncident.findFirst.mockResolvedValue({
      ...buildIncidentRecord(),
      feedback: [
        ...buildIncidentRecord().feedback,
        {
          id: 'feedback-2',
          authorType: 'GOV_AUDITOR',
          body: 'Please document follow-up with the guardian.',
          createdAt: new Date('2026-03-07T11:00:00.000Z'),
          updatedAt: new Date('2026-03-07T11:00:00.000Z'),
          authorUser: {
            id: 'auditor-1',
            firstName: 'Enga',
            lastName: 'Bertin',
          },
        },
      ],
    });

    const afterFeedback = await govService.addFeedback(
      auditorActor as any,
      'incident-1',
      {
        body: 'Please document follow-up with the guardian.',
      },
      context,
    );

    expect(mockedPrisma.conductFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-school',
          incidentId: 'incident-1',
          authorUserId: 'auditor-1',
        }),
      }),
    );
    expect(afterFeedback.feedback).toHaveLength(2);
    expect(mockedPrisma.auditLog.create).toHaveBeenCalled();
  });

  it('supports mark recalculation, lock, and in-scope mark feedback', async () => {
    mockedPrisma.student.findFirst.mockResolvedValue({
      id: 'student-1',
      studentCode: 'STU-001',
      firstName: 'Alice',
      lastName: 'Uwase',
      gender: 'FEMALE',
      dateOfBirth: new Date('2014-05-20T00:00:00.000Z'),
      enrollments: [],
    });

    mockedPrisma.conductMark.findUnique.mockResolvedValueOnce(null);
    mockedPrisma.conductMark.create.mockResolvedValueOnce(buildConductMarkRecord());

    const recalculated = await conductService.recalculateMark(
      'tenant-school',
      'student-1',
      'term-1',
      {},
      schoolActor as any,
      context,
    );
    expect(recalculated.score).toBe(18);
    expect(recalculated.maxScore).toBe(20);

    mockedPrisma.conductMark.findUnique.mockResolvedValueOnce(buildConductMarkRecord());
    mockedPrisma.conductMark.update.mockResolvedValueOnce(
      buildConductMarkRecord({
        isLocked: true,
        lockedAt: new Date('2026-03-08T09:00:00.000Z'),
        lockedByUser: {
          id: 'school-admin-1',
          firstName: 'School',
          lastName: 'Admin',
        },
      }),
    );

    const locked = await conductService.lockMark(
      'tenant-school',
      'student-1',
      'term-1',
      {
        reason: 'Term published',
      },
      schoolActor as any,
      context,
    );
    expect(locked.isLocked).toBe(true);

    mockedPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-platform',
    });
    mockedPrisma.govAuditorScope.findMany.mockResolvedValue([
      {
        id: 'scope-1',
        auditorUserId: 'auditor-1',
        scopeLevel: 'SECTOR',
        country: 'Rwanda',
        province: 'Eastern',
        district: 'Kayonza',
        sector: 'Manihira',
        notes: null,
        startsAt: null,
        endsAt: null,
        isActive: true,
        createdAt: new Date('2026-03-06T08:00:00.000Z'),
        updatedAt: new Date('2026-03-06T08:00:00.000Z'),
      },
    ]);

    mockedPrisma.conductMark.findFirst
      .mockResolvedValueOnce(buildGovConductMarkRecord())
      .mockResolvedValueOnce(
        buildGovConductMarkRecord({
          feedback: [
            {
              id: 'mark-feedback-1',
              authorType: 'GOV_AUDITOR',
              body: 'Please align with report-card policy.',
              createdAt: new Date('2026-03-08T09:10:00.000Z'),
              updatedAt: new Date('2026-03-08T09:10:00.000Z'),
              authorUser: {
                id: 'auditor-1',
                firstName: 'Enga',
                lastName: 'Bertin',
              },
            },
          ],
        }),
      );

    await govService.addMarkFeedback(
      auditorActor as any,
      'mark-1',
      {
        body: 'Please align with report-card policy.',
      },
      context,
    );

    expect(mockedPrisma.conductFeedback.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          tenantId: 'tenant-school',
          conductMarkId: 'mark-1',
          authorUserId: 'auditor-1',
        }),
      }),
    );
  });

  it('blocks an auditor outside the assigned scope', async () => {
    mockedPrisma.tenant.findUnique.mockResolvedValue({
      id: 'tenant-platform',
    });
    mockedPrisma.govAuditorScope.findMany.mockResolvedValue([]);

    await expect(
      govService.getIncidentDetail(outOfScopeAuditor as any, 'incident-1'),
    ).rejects.toMatchObject({
      code: 'GOV_SCOPE_FORBIDDEN',
      statusCode: 403,
    });
  });
});

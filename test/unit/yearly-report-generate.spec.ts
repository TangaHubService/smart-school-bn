jest.mock('../../src/db/prisma', () => ({
  prisma: {
    academicYear: { findFirst: jest.fn() },
    term: { findMany: jest.fn(), create: jest.fn() },
    resultSnapshot: { count: jest.fn(), findMany: jest.fn(), createMany: jest.fn() },
  },
}));

import { prisma } from '../../src/db/prisma';
import { JwtUser } from '../../src/common/types/auth.types';
import { ExamsService } from '../../src/modules/exams/exams.service';

const db = prisma as unknown as {
  academicYear: { findFirst: jest.Mock };
  term: { findMany: jest.Mock; create: jest.Mock };
  resultSnapshot: { count: jest.Mock; findMany: jest.Mock; createMany: jest.Mock };
};

const admin = {
  sub: 'admin-1',
  tenantId: 'tenant-1',
  roles: ['SCHOOL_ADMIN'],
  permissions: ['results.lock', 'results.publish'],
} as unknown as JwtUser;
const ctx = { requestId: 'r', ipAddress: null, userAgent: null } as never;
const input = {
  academicYearId: '11111111-1111-4111-8111-111111111111',
  classRoomId: '22222222-2222-4222-8222-222222222222',
  publish: true,
  regenerate: false,
};
const yearEnd = new Date('2026-07-31T00:00:00Z');
const teachingTerms = [
  { id: 't1', name: 'Term 1', sequence: 1, isActive: true },
  { id: 't2', name: 'Term 2', sequence: 2, isActive: true },
  { id: 't3', name: 'Term 3', sequence: 3, isActive: true },
];

function service() {
  const s = new ExamsService();
  const lock = jest.spyOn(s, 'lockResults').mockResolvedValue({ status: 'LOCKED', snapshotsCreated: 30, classSize: 30 });
  const unlock = jest.spyOn(s, 'unlockResults').mockResolvedValue(undefined as never);
  const publish = jest
    .spyOn(s, 'publishResults')
    .mockResolvedValue({ status: 'PUBLISHED', snapshotsUpdated: 30, publishedAt: new Date() });
  return { s, lock, unlock, publish };
}

describe('ExamsService.generateYearlyReportCards', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    db.academicYear.findFirst.mockResolvedValue({ id: input.academicYearId, name: '2025-2026', endDate: yearEnd });
    db.resultSnapshot.count.mockResolvedValue(0);
  });

  it('creates the Annual term on the last day of the year, then locks and publishes', async () => {
    db.term.findMany.mockResolvedValue(teachingTerms);
    db.term.create.mockImplementation(({ data }) => Promise.resolve({ id: 'annual', isActive: true, ...data }));
    const { s, lock, publish, unlock } = service();

    const result = await s.generateYearlyReportCards('tenant-1', input, admin, ctx);

    expect(db.term.create.mock.calls[0][0].data).toMatchObject({
      name: 'Annual',
      sequence: 4,
      startDate: yearEnd,
      endDate: yearEnd,
    });
    expect(lock).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ termId: 'annual' }), admin, ctx);
    expect(publish).toHaveBeenCalled();
    expect(unlock).not.toHaveBeenCalled();
    expect(result).toMatchObject({ status: 'PUBLISHED', snapshotsCreated: 30, term: { created: true } });
  });

  it('reuses an existing yearly term', async () => {
    db.term.findMany.mockResolvedValue([...teachingTerms, { id: 'y', name: 'Yearly', sequence: 4, isActive: true }]);
    const { s, lock } = service();
    await s.generateYearlyReportCards('tenant-1', { ...input, publish: false }, admin, ctx);
    expect(db.term.create).not.toHaveBeenCalled();
    expect(lock).toHaveBeenCalledWith('tenant-1', expect.objectContaining({ termId: 'y' }), admin, ctx);
  });

  it('asks before rebuilding report cards that already exist', async () => {
    db.term.findMany.mockResolvedValue([...teachingTerms, { id: 'y', name: 'Annual', sequence: 4, isActive: true }]);
    db.resultSnapshot.count.mockResolvedValue(30);
    const { s, lock } = service();
    await expect(s.generateYearlyReportCards('tenant-1', input, admin, ctx)).rejects.toMatchObject({
      code: 'RESULTS_ALREADY_LOCKED',
    });
    expect(lock).not.toHaveBeenCalled();
  });

  it('rebuilds when regenerate is chosen', async () => {
    db.term.findMany.mockResolvedValue([...teachingTerms, { id: 'y', name: 'Annual', sequence: 4, isActive: true }]);
    db.resultSnapshot.count.mockResolvedValue(30);
    const { s, lock, unlock } = service();
    const result = await s.generateYearlyReportCards('tenant-1', { ...input, regenerate: true }, admin, ctx);
    expect(unlock).toHaveBeenCalled();
    expect(lock).toHaveBeenCalled();
    expect(result.regenerated).toBe(true);
  });

  it('puts the old report cards back if the rebuild fails', async () => {
    db.term.findMany.mockResolvedValue([...teachingTerms, { id: 'y', name: 'Annual', sequence: 4, isActive: true }]);
    db.resultSnapshot.count.mockResolvedValue(1);
    const oldRow = { id: 'snap-1', termId: 'y', payload: { a: 1 }, status: 'PUBLISHED' };
    db.resultSnapshot.findMany.mockResolvedValue([oldRow]);
    const { s, lock, unlock } = service();
    lock.mockRejectedValueOnce(Object.assign(new Error('missing marks'), { code: 'RESULTS_MARKS_INCOMPLETE' }));

    await expect(
      s.generateYearlyReportCards('tenant-1', { ...input, regenerate: true }, admin, ctx)
    ).rejects.toMatchObject({ code: 'RESULTS_MARKS_INCOMPLETE' });
    expect(unlock).toHaveBeenCalled();
    expect(db.resultSnapshot.createMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: [expect.objectContaining({ id: 'snap-1', status: 'PUBLISHED' })] })
    );
  });

  it('only lets administrators generate', async () => {
    const teacher = { ...admin, roles: ['TEACHER'] } as JwtUser;
    const { s } = service();
    await expect(s.generateYearlyReportCards('tenant-1', input, teacher, ctx)).rejects.toMatchObject({ statusCode: 403 });
  });
});

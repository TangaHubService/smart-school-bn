jest.mock('../../src/db/prisma', () => {
  const prisma = {
    student: {
      findMany: jest.fn(),
    },
  };

  return { prisma };
});

import { prisma } from '../../src/db/prisma';
import { ParentsService } from '../../src/modules/parents/parents.service';

const mockedPrisma = prisma as any;

describe('parent linkable students flow', () => {
  const parentsService = new ParentsService();

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('filters linkable students by class and returns current enrollment details', async () => {
    mockedPrisma.student.findMany.mockResolvedValue([
      {
        id: 'student-1',
        studentCode: 'STU-001',
        firstName: 'Alice',
        lastName: 'Uwase',
        enrollments: [
          {
            id: 'enrollment-1',
            enrolledAt: new Date('2026-01-08T00:00:00.000Z'),
            academicYear: {
              id: 'year-1',
              name: '2026 Academic Year',
            },
            classRoom: {
              id: 'class-1',
              code: 'G1-A',
              name: 'Grade 1 A',
            },
          },
        ],
      },
    ]);

    const result = await parentsService.listLinkableStudents('tenant-1', {
      classId: 'class-1',
      q: 'ali',
      pageSize: 20,
    });

    expect(mockedPrisma.student.findMany).toHaveBeenCalledWith({
      where: {
        tenantId: 'tenant-1',
        deletedAt: null,
        isActive: true,
        enrollments: {
          some: {
            isActive: true,
            classRoomId: 'class-1',
          },
        },
        OR: [
          {
            studentCode: {
              contains: 'ali',
              mode: 'insensitive',
            },
          },
          {
            firstName: {
              contains: 'ali',
              mode: 'insensitive',
            },
          },
          {
            lastName: {
              contains: 'ali',
              mode: 'insensitive',
            },
          },
        ],
      },
      select: {
        id: true,
        studentCode: true,
        firstName: true,
        lastName: true,
        enrollments: {
          where: {
            isActive: true,
          },
          orderBy: [{ enrolledAt: 'desc' }],
          take: 1,
          select: {
            id: true,
            enrolledAt: true,
            academicYear: {
              select: {
                id: true,
                name: true,
              },
            },
            classRoom: {
              select: {
                id: true,
                code: true,
                name: true,
              },
            },
          },
        },
      },
      orderBy: [{ firstName: 'asc' }, { lastName: 'asc' }],
      take: 20,
    });

    expect(result).toEqual([
      {
        id: 'student-1',
        studentCode: 'STU-001',
        firstName: 'Alice',
        lastName: 'Uwase',
        currentEnrollment: {
          id: 'enrollment-1',
          enrolledAt: '2026-01-08T00:00:00.000Z',
          academicYear: {
            id: 'year-1',
            name: '2026 Academic Year',
          },
          classRoom: {
            id: 'class-1',
            code: 'G1-A',
            name: 'Grade 1 A',
          },
        },
      },
    ]);
  });
});

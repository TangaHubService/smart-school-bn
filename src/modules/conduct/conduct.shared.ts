import { Prisma } from '@prisma/client';

export const conductIncidentInclude = {
  tenant: {
    select: {
      id: true,
      code: true,
      name: true,
      school: {
        select: {
          id: true,
          displayName: true,
          province: true,
          district: true,
          sector: true,
          country: true,
        },
      },
    },
  },
  student: {
    select: {
      id: true,
      studentCode: true,
      firstName: true,
      lastName: true,
      gender: true,
      dateOfBirth: true,
      enrollments: {
        where: { isActive: true },
        orderBy: { enrolledAt: 'desc' },
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
  },
  classRoom: {
    select: {
      id: true,
      code: true,
      name: true,
    },
  },
  reportedByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  resolvedByUser: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
    },
  },
  actions: {
    orderBy: [{ actionDate: 'desc' }, { createdAt: 'desc' }],
    include: {
      createdByUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  },
  feedback: {
    orderBy: { createdAt: 'asc' },
    include: {
      authorUser: {
        select: {
          id: true,
          firstName: true,
          lastName: true,
        },
      },
    },
  },
} satisfies Prisma.ConductIncidentInclude;

export type ConductIncidentRecord = Prisma.ConductIncidentGetPayload<{
  include: typeof conductIncidentInclude;
}>;

export type ConductIncidentAudience = 'school' | 'gov';

function mapCurrentEnrollment(student: ConductIncidentRecord['student']) {
  const current = student.enrollments[0];

  if (!current) {
    return null;
  }

  return {
    id: current.id,
    enrolledAt: current.enrolledAt,
    academicYear: current.academicYear,
    classRoom: current.classRoom,
  };
}

export function mapConductIncident(
  incident: ConductIncidentRecord,
  audience: ConductIncidentAudience,
) {
  return {
    id: incident.id,
    tenantId: incident.tenantId,
    occurredAt: incident.occurredAt,
    category: incident.category,
    title: incident.title,
    description: incident.description,
    severity: incident.severity,
    status: incident.status,
    location: incident.location,
    reporterNotes: audience === 'school' ? incident.reporterNotes : null,
    resolutionSummary: incident.resolutionSummary,
    resolvedAt: incident.resolvedAt,
    createdAt: incident.createdAt,
    updatedAt: incident.updatedAt,
    school: incident.tenant.school
      ? {
          id: incident.tenant.school.id,
          tenantId: incident.tenant.id,
          code: incident.tenant.code,
          displayName: incident.tenant.school.displayName,
          province: incident.tenant.school.province,
          district: incident.tenant.school.district,
          sector: incident.tenant.school.sector,
          country: incident.tenant.school.country,
        }
      : null,
    student: {
      id: incident.student.id,
      studentCode: incident.student.studentCode,
      firstName: incident.student.firstName,
      lastName: incident.student.lastName,
      gender: incident.student.gender,
      dateOfBirth: audience === 'school' ? incident.student.dateOfBirth : null,
      currentEnrollment: mapCurrentEnrollment(incident.student),
    },
    classRoom: incident.classRoom,
    reportedBy: incident.reportedByUser
      ? {
          id: incident.reportedByUser.id,
          firstName: incident.reportedByUser.firstName,
          lastName: incident.reportedByUser.lastName,
        }
      : null,
    resolvedBy: incident.resolvedByUser
      ? {
          id: incident.resolvedByUser.id,
          firstName: incident.resolvedByUser.firstName,
          lastName: incident.resolvedByUser.lastName,
        }
      : null,
    actions: incident.actions.map((action) => ({
      id: action.id,
      type: action.type,
      title: action.title,
      description: action.description,
      actionDate: action.actionDate,
      dueDate: action.dueDate,
      completedAt: action.completedAt,
      createdAt: action.createdAt,
      updatedAt: action.updatedAt,
      createdBy: {
        id: action.createdByUser.id,
        firstName: action.createdByUser.firstName,
        lastName: action.createdByUser.lastName,
      },
    })),
    feedback: incident.feedback.map((entry) => ({
      id: entry.id,
      authorType: entry.authorType,
      body: entry.body,
      createdAt: entry.createdAt,
      updatedAt: entry.updatedAt,
      author: {
        id: entry.authorUser.id,
        firstName: entry.authorUser.firstName,
        lastName: entry.authorUser.lastName,
      },
    })),
  };
}

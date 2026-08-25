import { AttendanceStatus, Prisma, ResultSnapshotStatus } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { prisma } from '../../db/prisma';
import { AnnouncementsService } from '../announcements/announcements.service';

export interface SuperAdminDashboardData {
  metrics: {
    totalUsers: number;
    activeSchools: number;
    ongoingExams: number;
    supportTickets: number;
  };
  /** School SaaS plans + public academy enrollments / payments (best-effort if tables missing). */
  billing: {
    schoolSubscriptionsActive: number;
    academyLearnersActive: number;
    academyPaymentsPending: number;
  };
  userOverview: {
    administrators: number;
    schools: number;
    teachers: number;
    students: number;
    parents: number;
    classes: number;
    subjects: number;
    activeAccounts: number;
  };
  upcomingExams: Array<{
    id: string;
    title: string;
    date: string;
    time: string;
    relativeDate: string;
  }>;
  latestReports: Array<{
    id: string;
    name: string;
    count: number;
    icon: string;
  }>;
  systemAnalytics: {
    weekly: Array<{ label: string; logins: number; courses: number; exams: number }>;
    monthly: Array<{ label: string; logins: number; courses: number; exams: number }>;
  };
  revenue: {
    totalRevenue: number;
    monthlyRevenue: Array<{ month: string; amount: number }>;
    revenueThisMonth: number;
    revenueChange: number;
  };
  enrollmentTrends: {
    weekly: Array<{ label: string; count: number }>;
    monthly: Array<{ label: string; count: number }>;
  };
  completionRates: {
    courseCompletionRate: number | null;
    assessmentCompletionRate: number | null;
    overallRate: number | null;
  };
  activeUsers: {
    weeklyActive: number;
    monthlyActive: number;
  };
}

export interface SchoolAdminDashboardData {
  school: {
    displayName: string;
    city: string | null;
    logoUrl: string | null;
  };
  metrics: {
    totalStudents: number;
    studentsChange: number;
    teachers: number;
    teachersChange: number;
    classes: number;
    classesChange: number;
    subjects: number;
    attendanceToday: number | null;
    examsConducted: number;
  };
  userOverview: {
    students: number;
    studentsChange: number;
    teachers: number;
    teachersChange: number;
    parents: number;
    parentsChange: number;
    activeAccounts: number;
  };
  upcomingExams: Array<{
    id: string;
    title: string;
    date: string;
    time: string;
    relativeDate: string;
  }>;
  latestReports: Array<{
    id: string;
    name: string;
    value: string | number;
    icon: string;
  }>;
  systemAnalytics: {
    weekly: Array<{ label: string; logins: number; attendance: number; assignments: number }>;
    monthly: Array<{ label: string; logins: number; attendance: number; assignments: number }>;
  };
  revenue: {
    totalRevenue: number;
    monthlyRevenue: Array<{ month: string; amount: number }>;
    revenueThisMonth: number;
    revenueChange: number;
  };
  enrollmentTrends: {
    weekly: Array<{ label: string; count: number }>;
    monthly: Array<{ label: string; count: number }>;
  };
  completionRates: {
    courseCompletionRate: number | null;
    assessmentCompletionRate: number | null;
    overallRate: number | null;
  };
  activeUsers: {
    weeklyActive: number;
    monthlyActive: number;
  };
  overviewAnalytics: Array<{
    label: string;
    enrollments: number;
    attendance: number | null;
    assessments: number | null;
  }>;
  topClasses: Array<{
    id: string;
    name: string;
    averageScore: number;
    students: number;
  }>;
  quickInsights: {
    averageScore: number | null;
    passRate: number | null;
    attendanceRate: number | null;
    behaviorIndex: number | null;
    engagementScore: number | null;
  };
}

export class DashboardService {
  private readonly announcementsService = new AnnouncementsService();

  /**
   * User counts on the super admin dashboard must match {@link UsersService.listUsers}
   * for the same scope: login accounts (User rows), not standalone Student/Parent records.
   * Platform tenant users are included whenever the dashboard is not narrowed to one school.
   */
  private buildSuperAdminUserWhere(
    tenantsWhere: Prisma.TenantWhereInput,
    filters?: { school?: string }
  ): Prisma.UserWhereInput {
    const specificSchool = filters?.school && filters.school !== 'all-schools';

    if (specificSchool) {
      return { deletedAt: null, tenant: tenantsWhere };
    }

    return {
      deletedAt: null,
      OR: [{ tenant: tenantsWhere }, { tenant: { code: 'platform' } }],
    };
  }

  private buildSuperAdminTenantsWhere(
    filters?: { status?: string; region?: string; school?: string },
    regionStrategy: 'province-or-district' | 'district-only' = 'province-or-district'
  ): Prisma.TenantWhereInput {
    const statusFilter = filters?.status;
    const regionFilter = filters?.region;
    const schoolFilter = filters?.school;

    return {
      code: { not: 'platform' },
      ...(statusFilter === 'inactive'
        ? { isActive: false }
        : statusFilter === 'all'
          ? {}
          : { isActive: true }),
      ...(regionFilter && regionFilter !== 'all-regions'
        ? regionStrategy === 'district-only'
          ? { school: { district: regionFilter } }
          : {
              school: {
                OR: [{ province: regionFilter }, { district: regionFilter }],
              },
            }
        : {}),
      ...(schoolFilter && schoolFilter !== 'all-schools'
        ? {
            id: schoolFilter,
          }
        : {}),
    };
  }

  async getSuperAdminDashboard(
    _actor: JwtUser,
    filters?: {
      status?: string;
      region?: string;
      academicYear?: string;
      term?: string;
      school?: string;
    }
  ): Promise<SuperAdminDashboardData> {
    for (const regionStrategy of ['province-or-district', 'district-only'] as const) {
      try {
        return await this.computeSuperAdminDashboard(filters, regionStrategy);
      } catch (e: unknown) {
        const isMissingColumn =
          e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2022';
        if (isMissingColumn && regionStrategy === 'province-or-district') {
          continue;
        }
        throw e;
      }
    }
    throw new Error('Super admin dashboard: exhausted region strategies');
  }

  private async computeSuperAdminDashboard(
    filters?: {
      status?: string;
      region?: string;
      academicYear?: string;
      term?: string;
      school?: string;
    },
    regionStrategy: 'province-or-district' | 'district-only' = 'province-or-district'
  ): Promise<SuperAdminDashboardData> {
    const tenantsWhere = this.buildSuperAdminTenantsWhere(filters, regionStrategy);

    const userWhere = this.buildSuperAdminUserWhere(tenantsWhere, filters);

    const [
      totalUsers,
      activeSchools,
      superAdminUsersCount,
      schoolAdminUsersCount,
      teachersCount,
      studentsUsersCount,
      parentsUsersCount,
      activeAccountsCount,
      classesCount,
      subjectsCount,
      assessmentsCount,
      conductCount,
      exams,
    ] = await prisma.$transaction([
      prisma.user.count({
        where: userWhere,
      }),
      prisma.tenant.count({
        where: { ...tenantsWhere, school: { setupCompletedAt: { not: null } } },
      }),
      prisma.user.count({
        where: {
          ...userWhere,
          userRoles: { some: { role: { name: 'SUPER_ADMIN' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...userWhere,
          userRoles: { some: { role: { name: 'SCHOOL_ADMIN' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...userWhere,
          userRoles: { some: { role: { name: 'TEACHER' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...userWhere,
          userRoles: { some: { role: { name: 'STUDENT' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...userWhere,
          userRoles: { some: { role: { name: 'PARENT' } } },
        },
      }),
      prisma.user.count({
        where: {
          ...userWhere,
          status: 'ACTIVE',
        },
      }),
      prisma.classRoom.count({ where: { tenant: tenantsWhere } }),
      prisma.subject.count({ where: { tenant: tenantsWhere } }),
      prisma.assessment.count({
        where: { tenant: tenantsWhere, isPublished: true },
      }),
      prisma.conductIncident.count({ where: { tenant: tenantsWhere } }),
      prisma.exam.findMany({
        where: { tenant: tenantsWhere },
        take: 5,
        orderBy: { examDate: 'asc' },
        include: {
          subject: true,
          classRoom: true,
        },
      }),
    ]);

    const administratorsCount = superAdminUsersCount + schoolAdminUsersCount;

    const schoolCount = await prisma.tenant.count({
      where: tenantsWhere,
    });

    const now = new Date();
    let schoolSubscriptionsActive = 0;
    let academyLearnersActive = 0;
    let academyPaymentsPending = 0;
    try {
      schoolSubscriptionsActive = await prisma.schoolSubscription.count({
        where: { status: { in: ['ACTIVE', 'TRIALING'] } },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021')) {
        throw e;
      }
    }
    try {
      academyLearnersActive = await prisma.programEnrollment.count({
        where: {
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021')) {
        throw e;
      }
    }
    try {
      academyPaymentsPending = await prisma.payment.count({
        where: { status: 'PENDING' },
      });
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021')) {
        throw e;
      }
    }

    let totalRevenue = 0;
    let revenueThisMonth = 0;
    let revenueLastMonth = 0;
    let monthlyRevenue: Array<{ month: string; amount: number }> = [];
    try {
      const payments = await prisma.payment.findMany({
        where: { status: 'COMPLETED' },
        select: { amount: true, createdAt: true },
      });
      totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
      const monthMap = new Map<string, number>();
      const nowDate = new Date();
      const curMonth = nowDate.getMonth();
      const curYear = nowDate.getFullYear();
      for (const p of payments) {
        const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, '0')}`;
        monthMap.set(key, (monthMap.get(key) || 0) + p.amount);
        if (p.createdAt.getMonth() === curMonth && p.createdAt.getFullYear() === curYear) {
          revenueThisMonth += p.amount;
        }
        const lastM = curMonth === 0 ? 11 : curMonth - 1;
        const lastY = curMonth === 0 ? curYear - 1 : curYear;
        if (p.createdAt.getMonth() === lastM && p.createdAt.getFullYear() === lastY) {
          revenueLastMonth += p.amount;
        }
      }
      monthlyRevenue = Array.from(monthMap.entries())
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12);
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021')) {
        throw e;
      }
    }
    const revenueChange =
      revenueLastMonth > 0
        ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
        : 0;

    let enrollmentTrends: SuperAdminDashboardData['enrollmentTrends'] = { weekly: [], monthly: [] };
    try {
      const enrollments = await prisma.programEnrollment.findMany({
        select: { createdAt: true },
        orderBy: { createdAt: 'asc' },
      });
      const weekMap = new Map<string, number>();
      const monthMap2 = new Map<string, number>();
      for (const e of enrollments) {
        const d = e.createdAt;
        const weekStart = new Date(d);
        weekStart.setDate(d.getDate() - d.getDay());
        const weekKey = weekStart.toISOString().slice(0, 10);
        weekMap.set(weekKey, (weekMap.get(weekKey) || 0) + 1);
        const monthKey = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        monthMap2.set(monthKey, (monthMap2.get(monthKey) || 0) + 1);
      }
      enrollmentTrends = {
        weekly: Array.from(weekMap.entries())
          .map(([label, count]) => ({ label, count }))
          .slice(-7),
        monthly: Array.from(monthMap2.entries())
          .map(([label, count]) => ({ label, count }))
          .slice(-12),
      };
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021')) {
        throw e;
      }
    }

    let courseCompletionRate: number | null = null;
    let assessmentCompletionRate: number | null = null;
    try {
      const totalEnrollments = await prisma.programEnrollment.count();
      const completedEnrollments = await prisma.programEnrollment.count({
        where: { isActive: false },
      });
      courseCompletionRate =
        totalEnrollments > 0 ? Math.round((completedEnrollments / totalEnrollments) * 100) : null;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021')) {
        throw e;
      }
    }
    try {
      const totalAttempts = await prisma.assessmentAttempt.count();
      const scoredAttempts = await prisma.assessmentAttempt.count({
        where: { autoScore: { not: null }, status: 'SUBMITTED' },
      });
      assessmentCompletionRate =
        totalAttempts > 0 ? Math.round((scoredAttempts / totalAttempts) * 100) : null;
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021')) {
        throw e;
      }
    }
    const overallRate =
      courseCompletionRate !== null && assessmentCompletionRate !== null
        ? Math.round((courseCompletionRate + assessmentCompletionRate) / 2)
        : (courseCompletionRate ?? assessmentCompletionRate);

    let weeklyActive = 0;
    let monthlyActive = 0;
    try {
      const sevenDays = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const thirtyDays = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
      [weeklyActive, monthlyActive] = await Promise.all([
        prisma.user.count({ where: { updatedAt: { gte: sevenDays }, deletedAt: null } }),
        prisma.user.count({ where: { updatedAt: { gte: thirtyDays }, deletedAt: null } }),
      ]);
    } catch {
      // best-effort
    }

    const formatRelativeDate = (date: Date): string => {
      const now = new Date();
      const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff > 1 && diff <= 7) return `In ${diff} Days`;
      return date.toLocaleDateString();
    };

    return {
      metrics: {
        totalUsers,
        activeSchools,
        ongoingExams: assessmentsCount,
        supportTickets: 5,
      },
      billing: {
        schoolSubscriptionsActive,
        academyLearnersActive,
        academyPaymentsPending,
      },
      userOverview: {
        administrators: administratorsCount,
        schools: schoolCount,
        teachers: teachersCount,
        students: studentsUsersCount,
        parents: parentsUsersCount,
        classes: classesCount,
        subjects: subjectsCount,
        activeAccounts: activeAccountsCount,
      },
      upcomingExams: exams.slice(0, 3).map(exam => {
        const examDate = exam.examDate ?? exam.createdAt;
        return {
          id: exam.id,
          title: exam.name ?? `${exam.subject?.name ?? 'Exam'}`,
          date: examDate.toISOString().split('T')[0],
          time: examDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
          relativeDate: formatRelativeDate(examDate),
        };
      }),
      latestReports: [
        { id: 'student', name: 'Student Report', count: studentsUsersCount, icon: 'user' },
        { id: 'teachers', name: 'Teachers Report', count: teachersCount, icon: 'user' },
        { id: 'admin', name: 'Admin Report', count: administratorsCount, icon: 'user' },
        { id: 'school', name: 'School Report', count: schoolCount, icon: 'school' },
        { id: 'finance', name: 'Finance Report', count: 35, icon: 'document' },
        { id: 'discipline', name: 'Discipline Report', count: conductCount, icon: 'message' },
      ],
      systemAnalytics: {
        weekly: this.buildSuperAdminAnalyticsSeries('weekly', {
          logins: totalUsers,
          courses: classesCount,
          exams: assessmentsCount,
        }),
        monthly: this.buildSuperAdminAnalyticsSeries('monthly', {
          logins: totalUsers,
          courses: classesCount,
          exams: assessmentsCount,
        }),
      },
      revenue: {
        totalRevenue,
        monthlyRevenue,
        revenueThisMonth,
        revenueChange,
      },
      enrollmentTrends,
      completionRates: {
        courseCompletionRate,
        assessmentCompletionRate,
        overallRate,
      },
      activeUsers: {
        weeklyActive,
        monthlyActive,
      },
    };
  }

  private buildSuperAdminAnalyticsSeries(
    kind: 'weekly' | 'monthly',
    totals: { logins: number; courses: number; exams: number }
  ): Array<{ label: string; logins: number; courses: number; exams: number }> {
    const points = kind === 'weekly' ? 7 : 12;
    const labels =
      kind === 'weekly'
        ? ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']
        : ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const scale = (total: number, index: number) =>
      Math.max(0, Math.round((total / points) * (0.65 + (index % 5) * 0.07)));

    return Array.from({ length: points }, (_, i) => ({
      label: labels[i] ?? `P${i + 1}`,
      logins: scale(totals.logins, i),
      courses: scale(totals.courses, i + 2),
      exams: scale(totals.exams, i + 4),
    }));
  }

  async getSuperAdminFilters(_actor: JwtUser) {
    try {
      return await this.loadSuperAdminFilterOptionsPreferProvince();
    } catch (e: unknown) {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2022') {
        return this.loadSuperAdminFilterOptionsDistrictOnly();
      }
      throw e;
    }
  }

  /** Loads School columns that may not exist until later migrations (e.g. province, logoUrl). */
  private async loadSuperAdminFilterOptionsPreferProvince() {
    const [tenants, academicYears, terms] = await prisma.$transaction([
      prisma.tenant.findMany({
        where: { code: { not: 'platform' } },
        include: {
          school: {
            select: {
              displayName: true,
              province: true,
              district: true,
              city: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.academicYear.findMany({
        where: { isActive: true },
        distinct: ['name'],
        orderBy: { startDate: 'desc' },
      }),
      prisma.term.findMany({
        where: { isActive: true },
        distinct: ['name'],
        orderBy: { sequence: 'asc' },
      }),
    ]);

    const regions = Array.from(
      new Set(
        tenants.flatMap(t => {
          const s = t.school;
          if (!s) return [];
          return [s.province, s.district].filter((v): v is string => Boolean(v));
        })
      )
    ).sort();

    return {
      schools: tenants.map(t => ({
        id: t.id,
        name: t.school?.displayName ?? t.name,
        province: t.school?.province ?? t.school?.district ?? null,
        isActive: t.isActive,
      })),
      regions,
      academicYears: academicYears.map(ay => ({
        id: ay.id,
        name: ay.name,
      })),
      terms: terms.map(term => ({
        id: term.id,
        name: term.name,
        sequence: term.sequence,
      })),
    };
  }

  /** Fallback when School is missing columns added after sprint1 (e.g. province). */
  private async loadSuperAdminFilterOptionsDistrictOnly() {
    const [tenants, academicYears, terms] = await prisma.$transaction([
      prisma.tenant.findMany({
        where: { code: { not: 'platform' } },
        include: {
          school: {
            select: {
              displayName: true,
              district: true,
              city: true,
            },
          },
        },
        orderBy: { name: 'asc' },
      }),
      prisma.academicYear.findMany({
        where: { isActive: true },
        distinct: ['name'],
        orderBy: { startDate: 'desc' },
      }),
      prisma.term.findMany({
        where: { isActive: true },
        distinct: ['name'],
        orderBy: { sequence: 'asc' },
      }),
    ]);

    const regions = Array.from(
      new Set(tenants.map(t => t.school?.district).filter((v): v is string => Boolean(v)))
    ).sort();

    return {
      schools: tenants.map(t => ({
        id: t.id,
        name: t.school?.displayName ?? t.name,
        province: null,
        isActive: t.isActive,
      })),
      regions,
      academicYears: academicYears.map(ay => ({
        id: ay.id,
        name: ay.name,
      })),
      terms: terms.map(term => ({
        id: term.id,
        name: term.name,
        sequence: term.sequence,
      })),
    };
  }

  async getSchoolAdminDashboard(
    actor: JwtUser,
    filters?: { academicYear?: string; term?: string; class?: string; find?: string }
  ): Promise<SchoolAdminDashboardData> {
    const tenantId = actor.tenantId!;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { code: true },
    });
    if (!tenant || tenant.code === 'platform') {
      throw new AppError(
        403,
        'TENANT_NOT_SCHOOL',
        'School admin dashboard is not available for platform accounts'
      );
    }

    const now = new Date();
    const currentMonthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const selectedAcademicYear = filters?.academicYear
      ? await prisma.academicYear.findFirst({
          where: { id: filters.academicYear, tenantId },
          select: { id: true, name: true },
        })
      : ((await prisma.academicYear.findFirst({
          where: { tenantId, isCurrent: true, isActive: true },
          orderBy: { startDate: 'desc' },
          select: { id: true, name: true },
        })) ??
        (await prisma.academicYear.findFirst({
          where: { tenantId, isActive: true },
          orderBy: { startDate: 'desc' },
          select: { id: true, name: true },
        })));
    const academicYearId = selectedAcademicYear?.id;

    const termSequenceByCode: Record<string, number> = { first: 1, second: 2, third: 3 };
    const requestedTerm = filters?.term;
    const requestedSequence = requestedTerm
      ? (termSequenceByCode[requestedTerm] ?? Number(requestedTerm.replace(/^term-/, '')))
      : undefined;
    const selectedTerm = academicYearId
      ? await prisma.term.findFirst({
          where: {
            tenantId,
            academicYearId,
            ...(requestedTerm && !Number.isNaN(requestedSequence)
              ? { sequence: requestedSequence }
              : requestedTerm
                ? { OR: [{ id: requestedTerm }, { name: requestedTerm }] }
                : { isActive: true }),
          },
          orderBy: { sequence: 'asc' },
          select: { id: true, sequence: true, startDate: true, endDate: true },
        })
      : null;
    const termId = selectedTerm?.id;

    const selectedClass =
      filters?.class && filters.class !== 'all'
        ? await prisma.classRoom.findFirst({
            where: { id: filters.class, tenantId },
            select: { id: true },
          })
        : null;
    const classRoomId = selectedClass?.id;
    const selectedCourse =
      filters?.find && filters.find !== 'all'
        ? await prisma.course.findFirst({
            where: { id: filters.find, tenantId },
            select: { id: true, subjectId: true, classRoomId: true },
          })
        : null;
    const effectiveClassRoomId = classRoomId ?? selectedCourse?.classRoomId;

    const enrollmentWhere: Prisma.StudentEnrollmentWhereInput = {
      tenantId,
      isActive: true,
      ...(academicYearId ? { academicYearId } : {}),
      ...(effectiveClassRoomId ? { classRoomId: effectiveClassRoomId } : {}),
    };
    const courseWhere: Prisma.CourseWhereInput = {
      tenantId,
      ...(academicYearId ? { academicYearId } : {}),
      ...(effectiveClassRoomId ? { classRoomId: effectiveClassRoomId } : {}),
      ...(selectedCourse ? { id: selectedCourse.id } : {}),
    };
    const examWhere: Prisma.ExamWhereInput = {
      tenantId,
      ...(academicYearId ? { academicYearId } : {}),
      ...(termId ? { termId } : {}),
      ...(effectiveClassRoomId ? { classRoomId: effectiveClassRoomId } : {}),
      ...(selectedCourse?.subjectId ? { subjectId: selectedCourse.subjectId } : {}),
    };
    const attendanceWhere: Prisma.AttendanceRecordWhereInput = {
      tenantId,
      ...(effectiveClassRoomId ? { classRoomId: effectiveClassRoomId } : {}),
      ...(academicYearId ? { session: { academicYearId } } : {}),
    };

    const todayString = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(now);
    const todayStart = /^\d{4}-\d{2}-\d{2}$/.test(todayString)
      ? new Date(`${todayString}T00:00:00.000Z`)
      : new Date(`${now.toISOString().slice(0, 10)}T00:00:00.000Z`);
    const tomorrowStart = new Date(todayStart);
    tomorrowStart.setUTCDate(tomorrowStart.getUTCDate() + 1);
    const sevenDaysAgo = new Date(todayStart);
    sevenDaysAgo.setUTCDate(sevenDaysAgo.getUTCDate() - 6);

    const school = await prisma.school.findUniqueOrThrow({
      where: { tenantId },
      select: { displayName: true, city: true, logoUrl: true },
    });

    const teacherCourses = await prisma.course.findMany({
      where: courseWhere,
      distinct: ['teacherUserId'],
      select: { teacherUserId: true },
    });
    const subjectCourses = await prisma.course.findMany({
      where: { ...courseWhere, subjectId: { not: null } },
      distinct: ['subjectId'],
      select: { subjectId: true },
    });

    const [
      studentsCount,
      classesCount,
      parentsCount,
      activeUserAccounts,
      studentsChange,
      teachersChange,
      classesChange,
      parentsChange,
      upcomingExams,
      examsConducted,
      todayAttendanceTotal,
      todayPresent,
      attendanceSessionsThisWeek,
      submissionsCount,
      conductIncidentsOpen,
      weeklyActive,
      monthlyActive,
    ] = await prisma.$transaction([
      prisma.studentEnrollment.count({ where: enrollmentWhere }),
      prisma.classRoom.count({
        where: {
          tenantId,
          isActive: true,
          ...(effectiveClassRoomId
            ? { id: effectiveClassRoomId }
            : academicYearId
              ? { enrollments: { some: { academicYearId, isActive: true } } }
              : {}),
        },
      }),
      prisma.parent.count({ where: { tenantId, deletedAt: null, isActive: true } }),
      prisma.user.count({ where: { tenantId, deletedAt: null, status: 'ACTIVE' } }),
      prisma.studentEnrollment.count({
        where: { ...enrollmentWhere, enrolledAt: { gte: currentMonthStart } },
      }),
      prisma.userRole.count({
        where: {
          tenantId,
          role: { name: 'TEACHER' },
          user: { deletedAt: null },
          assignedAt: { gte: currentMonthStart },
        },
      }),
      prisma.classRoom.count({
        where: {
          tenantId,
          createdAt: { gte: currentMonthStart },
          ...(effectiveClassRoomId ? { id: effectiveClassRoomId } : {}),
        },
      }),
      prisma.parent.count({
        where: { tenantId, deletedAt: null, createdAt: { gte: currentMonthStart } },
      }),
      prisma.exam.findMany({
        where: { ...examWhere, examDate: { gte: todayStart } },
        take: 5,
        orderBy: { examDate: 'asc' },
        include: { subject: true },
      }),
      prisma.exam.count({ where: { ...examWhere, marks: { some: {} } } }),
      prisma.attendanceRecord.count({
        where: {
          ...attendanceWhere,
          attendanceDate: { gte: todayStart, lt: tomorrowStart },
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          ...attendanceWhere,
          attendanceDate: { gte: todayStart, lt: tomorrowStart },
          status: { in: ['PRESENT', 'LATE'] },
        },
      }),
      prisma.attendanceSession.count({
        where: {
          tenantId,
          sessionDate: { gte: sevenDaysAgo, lt: tomorrowStart },
          ...(academicYearId ? { academicYearId } : {}),
          ...(effectiveClassRoomId ? { classRoomId: effectiveClassRoomId } : {}),
        },
      }),
      prisma.submission.count({
        where: { assignment: { course: courseWhere }, status: { in: ['SUBMITTED', 'GRADED'] } },
      }),
      prisma.conductIncident.count({
        where: {
          tenantId,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
          ...(effectiveClassRoomId ? { classRoomId: effectiveClassRoomId } : {}),
        },
      }),
      prisma.user.count({
        where: { tenantId, deletedAt: null, lastLoginAt: { gte: sevenDaysAgo } },
      }),
      prisma.user.count({
        where: {
          tenantId,
          deletedAt: null,
          lastLoginAt: { gte: new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000) },
        },
      }),
    ]);

    const teachersCount = teacherCourses.length;
    const subjectsCount = academicYearId
      ? subjectCourses.length
      : await prisma.subject.count({ where: { tenantId, isActive: true } });
    const activeAccounts = activeUserAccounts + studentsCount;
    const attendanceToday = todayAttendanceTotal
      ? Number(((todayPresent / todayAttendanceTotal) * 100).toFixed(1))
      : null;

    let totalRevenue = 0;
    let revenueThisMonth = 0;
    let revenueLastMonth = 0;
    let monthlyRevenue: Array<{ month: string; amount: number }> = [];
    try {
      const payments = await prisma.payment.findMany({
        where: { tenantId, status: 'COMPLETED' },
        select: { amount: true, createdAt: true },
      });
      totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
      const monthMap = new Map<string, number>();
      const nowDate = new Date();
      const curMonth = nowDate.getMonth();
      const curYear = nowDate.getFullYear();
      for (const p of payments) {
        const key = `${p.createdAt.getFullYear()}-${String(p.createdAt.getMonth() + 1).padStart(2, '0')}`;
        monthMap.set(key, (monthMap.get(key) || 0) + p.amount);
        if (p.createdAt.getMonth() === curMonth && p.createdAt.getFullYear() === curYear) {
          revenueThisMonth += p.amount;
        }
        const lastM = curMonth === 0 ? 11 : curMonth - 1;
        const lastY = curMonth === 0 ? curYear - 1 : curYear;
        if (p.createdAt.getMonth() === lastM && p.createdAt.getFullYear() === lastY) {
          revenueLastMonth += p.amount;
        }
      }
      monthlyRevenue = Array.from(monthMap.entries())
        .map(([month, amount]) => ({ month, amount }))
        .sort((a, b) => a.month.localeCompare(b.month))
        .slice(-12);
    } catch (e) {
      if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2021')) {
        throw e;
      }
    }
    const revenueChange =
      revenueLastMonth > 0
        ? Math.round(((revenueThisMonth - revenueLastMonth) / revenueLastMonth) * 100)
        : 0;

    const monthStarts = Array.from({ length: 8 }, (_, index) => {
      const monthsBack = 7 - index;
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
    });
    const seriesStart = monthStarts[0];
    const seriesEnd = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
    const [
      enrollmentsForSeries,
      attendanceForSeries,
      attemptsForSeries,
      loginsForSeries,
      submissionsForSeries,
    ] = await prisma.$transaction([
      prisma.studentEnrollment.findMany({
        where: { ...enrollmentWhere, enrolledAt: { lt: seriesEnd } },
        select: { enrolledAt: true },
      }),
      prisma.attendanceRecord.findMany({
        where: {
          ...attendanceWhere,
          attendanceDate: { gte: seriesStart, lt: seriesEnd },
        },
        select: { attendanceDate: true, status: true },
      }),
      prisma.assessmentAttempt.findMany({
        where: {
          tenantId,
          status: 'SUBMITTED',
          submittedAt: { gte: seriesStart, lt: seriesEnd },
          assessment: { course: courseWhere },
        },
        select: { submittedAt: true, autoScore: true, manualScore: true, maxScore: true },
      }),
      prisma.user.findMany({
        where: { tenantId, deletedAt: null, lastLoginAt: { gte: seriesStart, lt: seriesEnd } },
        select: { lastLoginAt: true },
      }),
      prisma.submission.findMany({
        where: {
          status: { in: ['SUBMITTED', 'GRADED'] },
          submittedAt: { gte: seriesStart, lt: seriesEnd },
          assignment: { course: courseWhere },
        },
        select: { submittedAt: true },
      }),
    ]);

    const monthKey = (date: Date) =>
      `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, '0')}`;
    const overviewAnalytics = monthStarts.map(monthStart => {
      const nextMonth = new Date(
        Date.UTC(monthStart.getUTCFullYear(), monthStart.getUTCMonth() + 1, 1)
      );
      const attendanceRows = attendanceForSeries.filter(
        row => monthKey(row.attendanceDate) === monthKey(monthStart)
      );
      const attended = attendanceRows.filter(
        row => row.status === 'PRESENT' || row.status === 'LATE'
      ).length;
      const attempts = attemptsForSeries.filter(
        row => row.submittedAt && monthKey(row.submittedAt) === monthKey(monthStart)
      );
      const scoredAttempts = attempts
        .map(row => {
          const score = row.manualScore ?? row.autoScore;
          return score !== null && row.maxScore && row.maxScore > 0
            ? (score / row.maxScore) * 100
            : null;
        })
        .filter((score): score is number => score !== null);

      return {
        label: monthStart.toLocaleDateString('en-US', { month: 'short' }),
        enrollments: enrollmentsForSeries.filter(row => row.enrolledAt < nextMonth).length,
        attendance: attendanceRows.length
          ? Number(((attended / attendanceRows.length) * 100).toFixed(1))
          : null,
        assessments: scoredAttempts.length
          ? Number(
              (
                scoredAttempts.reduce((sum, score) => sum + score, 0) / scoredAttempts.length
              ).toFixed(1)
            )
          : null,
      };
    });

    const lastSevenDays = Array.from({ length: 7 }, (_, index) => {
      const date = new Date(sevenDaysAgo);
      date.setUTCDate(date.getUTCDate() + index);
      return date;
    });
    const dayKey = (date: Date) => date.toISOString().slice(0, 10);
    const systemAnalyticsWeekly = lastSevenDays.map(date => ({
      label: date.toLocaleDateString('en-US', { weekday: 'short' }),
      logins: loginsForSeries.filter(
        row => row.lastLoginAt && dayKey(row.lastLoginAt) === dayKey(date)
      ).length,
      attendance: attendanceForSeries.filter(row => dayKey(row.attendanceDate) === dayKey(date))
        .length,
      assignments: submissionsForSeries.filter(row => dayKey(row.submittedAt) === dayKey(date))
        .length,
    }));
    const systemAnalyticsMonthly = monthStarts.map((monthStart, index) => ({
      label: overviewAnalytics[index].label,
      logins: loginsForSeries.filter(
        row => row.lastLoginAt && monthKey(row.lastLoginAt) === monthKey(monthStart)
      ).length,
      attendance: attendanceForSeries.filter(
        row => monthKey(row.attendanceDate) === monthKey(monthStart)
      ).length,
      assignments: submissionsForSeries.filter(
        row => monthKey(row.submittedAt) === monthKey(monthStart)
      ).length,
    }));
    const enrollmentTrends: SchoolAdminDashboardData['enrollmentTrends'] = {
      weekly: lastSevenDays.map(date => ({
        label: dayKey(date),
        count: enrollmentsForSeries.filter(row => dayKey(row.enrolledAt) === dayKey(date)).length,
      })),
      monthly: monthStarts.map((date, index) => ({
        label: monthKey(date),
        count: overviewAnalytics[index].enrollments,
      })),
    };

    let courseCompletionRate: number | null = null;
    let assessmentCompletionRate: number | null = null;
    try {
      const totalCourses = await prisma.course.count({ where: { tenantId } });
      const completedCourses = await prisma.course.count({ where: { tenantId, isActive: false } });
      courseCompletionRate =
        totalCourses > 0 ? Math.round((completedCourses / totalCourses) * 100) : null;
    } catch {
      // best-effort
    }
    try {
      const totalAttempts = await prisma.assessmentAttempt.count({
        where: { tenantId, status: 'SUBMITTED' },
      });
      const scoredAttempts = await prisma.assessmentAttempt.count({
        where: { tenantId, autoScore: { not: null }, status: 'SUBMITTED' },
      });
      assessmentCompletionRate =
        totalAttempts > 0 ? Math.round((scoredAttempts / totalAttempts) * 100) : null;
    } catch {
      // best-effort
    }
    const overallRate =
      courseCompletionRate !== null && assessmentCompletionRate !== null
        ? Math.round((courseCompletionRate + assessmentCompletionRate) / 2)
        : (courseCompletionRate ?? assessmentCompletionRate);

    const [
      examMarks,
      passPolicies,
      allAttendanceCount,
      presentAttendanceCount,
      lessonProgressTotal,
      lessonProgressComplete,
    ] = await prisma.$transaction([
      prisma.examMark.findMany({
        where: { tenantId, marksObtained: { not: null }, exam: examWhere },
        select: {
          studentId: true,
          marksObtained: true,
          exam: {
            select: {
              termId: true,
              classRoomId: true,
              subjectId: true,
              totalMarks: true,
              classRoom: { select: { id: true, code: true, name: true } },
            },
          },
        },
      }),
      prisma.subjectAssessmentPolicy.findMany({
        where: {
          tenantId,
          ...(academicYearId ? { academicYearId } : {}),
          ...(termId ? { termId } : {}),
          ...(effectiveClassRoomId ? { classRoomId: effectiveClassRoomId } : {}),
          ...(selectedCourse?.subjectId ? { subjectId: selectedCourse.subjectId } : {}),
        },
        select: { termId: true, classRoomId: true, subjectId: true, passMark: true },
      }),
      prisma.attendanceRecord.count({
        where: attendanceWhere,
      }),
      prisma.attendanceRecord.count({
        where: { ...attendanceWhere, status: { in: ['PRESENT', 'LATE'] } },
      }),
      prisma.studentLessonProgress.count({
        where: { tenantId, lesson: { course: courseWhere } },
      }),
      prisma.studentLessonProgress.count({
        where: { tenantId, isCompleted: true, lesson: { course: courseWhere } },
      }),
    ]);

    const policyMap = new Map(
      passPolicies.map(policy => [
        `${policy.termId}:${policy.classRoomId}:${policy.subjectId}`,
        policy.passMark,
      ])
    );
    const classScores = new Map<
      string,
      { name: string; scores: number[]; studentIds: Set<string> }
    >();
    const allScores: number[] = [];
    let passEligible = 0;
    let passed = 0;
    for (const mark of examMarks) {
      if (mark.marksObtained === null || mark.exam.totalMarks <= 0) continue;
      const score = (mark.marksObtained / mark.exam.totalMarks) * 100;
      allScores.push(score);
      const room = mark.exam.classRoom;
      const current = classScores.get(room.id) ?? {
        name: `${room.code}${room.code && room.name ? ' · ' : ''}${room.name}`.trim(),
        scores: [],
        studentIds: new Set<string>(),
      };
      current.scores.push(score);
      current.studentIds.add(mark.studentId);
      classScores.set(room.id, current);

      const passMark = policyMap.get(
        `${mark.exam.termId}:${mark.exam.classRoomId}:${mark.exam.subjectId}`
      );
      if (passMark !== undefined) {
        passEligible += 1;
        if (score >= passMark) passed += 1;
      }
    }
    const topClasses = Array.from(classScores.entries())
      .map(([id, value]) => ({
        id,
        name: value.name,
        averageScore: Number(
          (value.scores.reduce((sum, score) => sum + score, 0) / value.scores.length).toFixed(1)
        ),
        students: value.studentIds.size,
      }))
      .sort((a, b) => b.averageScore - a.averageScore)
      .slice(0, 5);
    const averageScore = allScores.length
      ? Number((allScores.reduce((sum, score) => sum + score, 0) / allScores.length).toFixed(1))
      : null;
    const passRate = passEligible ? Number(((passed / passEligible) * 100).toFixed(1)) : null;
    const attendanceRate = allAttendanceCount
      ? Number(((presentAttendanceCount / allAttendanceCount) * 100).toFixed(1))
      : null;

    let behaviorIndex: number | null = null;
    if (termId && studentsCount > 0) {
      const [conductSetting, deductionAggregate] = await prisma.$transaction([
        prisma.conductTermSetting.findUnique({
          where: { tenantId_termId: { tenantId, termId } },
          select: { totalMarks: true },
        }),
        prisma.conductDeduction.aggregate({
          where: {
            tenantId,
            termId,
            ...(effectiveClassRoomId ? { classRoomId: effectiveClassRoomId } : {}),
          },
          _sum: { pointsDeducted: true },
        }),
      ]);
      if (conductSetting?.totalMarks) {
        const averageDeduction = (deductionAggregate._sum.pointsDeducted ?? 0) / studentsCount;
        behaviorIndex = Number(
          (
            (Math.max(0, conductSetting.totalMarks - averageDeduction) /
              conductSetting.totalMarks) *
            100
          ).toFixed(1)
        );
      }
    }
    const engagementScore = lessonProgressTotal
      ? Number(((lessonProgressComplete / lessonProgressTotal) * 100).toFixed(1))
      : null;

    const formatRelativeDate = (date: Date): string => {
      const now = new Date();
      const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff > 1 && diff <= 7) return `In ${diff} Days`;
      return date.toLocaleDateString();
    };

    return {
      school: {
        displayName: school.displayName,
        city: school.city,
        logoUrl: school.logoUrl ?? null,
      },
      metrics: {
        totalStudents: studentsCount,
        studentsChange,
        teachers: teachersCount,
        teachersChange,
        classes: classesCount,
        classesChange,
        subjects: subjectsCount,
        attendanceToday,
        examsConducted,
      },
      userOverview: {
        students: studentsCount,
        studentsChange,
        teachers: teachersCount,
        teachersChange,
        parents: parentsCount,
        parentsChange,
        activeAccounts,
      },
      upcomingExams: upcomingExams.slice(0, 3).map(exam => {
        const examDate = exam.examDate ?? exam.createdAt;
        return {
          id: exam.id,
          title: exam.name ?? `${exam.subject?.name ?? 'Exam'}`,
          date: examDate.toISOString().split('T')[0],
          time: examDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
          relativeDate: formatRelativeDate(examDate),
        };
      }),
      latestReports: [
        {
          id: 'attendance-sessions',
          name: 'Attendance sessions (7d)',
          value: attendanceSessionsThisWeek,
          icon: 'check',
        },
        {
          id: 'assignments',
          name: 'Submissions (all time)',
          value: submissionsCount,
          icon: 'document',
        },
        {
          id: 'conduct-open',
          name: 'Open conduct cases',
          value: conductIncidentsOpen,
          icon: 'grid',
        },
      ],
      systemAnalytics: {
        weekly: systemAnalyticsWeekly,
        monthly: systemAnalyticsMonthly,
      },
      revenue: {
        totalRevenue,
        monthlyRevenue,
        revenueThisMonth,
        revenueChange,
      },
      enrollmentTrends,
      completionRates: {
        courseCompletionRate,
        assessmentCompletionRate,
        overallRate,
      },
      activeUsers: {
        weeklyActive,
        monthlyActive,
      },
      overviewAnalytics,
      topClasses,
      quickInsights: {
        averageScore,
        passRate,
        attendanceRate,
        behaviorIndex,
        engagementScore,
      },
    };
  }

  async getStudentDashboard(actor: JwtUser): Promise<{
    school: { displayName: string; city: string | null };
    metrics: {
      myCourses: number;
      assignmentsSubmitted: number;
      myAssessments: number;
      reportCards: number;
    };
    learningStats: {
      timeSpentSecondsTotal: number;
      lastLessonActivityAt: string | null;
      avgAssessmentScorePercent: number | null;
    };
    upcomingExams: Array<{
      id: string;
      title: string;
      date: string;
      time: string;
      relativeDate: string;
      classLabel: string;
      subjectName: string;
    }>;
    latestReports: Array<{ id: string; name: string; value: string | number }>;
    recentAnnouncements: Array<{
      id: string;
      title: string;
      publishedAt: string | null;
      excerpt: string;
    }>;
    attendanceWeek: {
      daysWithRecords: number;
      present: number;
      absent: number;
      late: number;
      excused: number;
    } | null;
    conductOpen: number | null;
  }> {
    const tenantId = actor.tenantId!;
    const userId = actor.sub;

    const student = await prisma.student.findFirst({
      where: { tenantId, userId, deletedAt: null },
      select: { id: true },
    });
    if (!student) {
      throw new AppError(403, 'STUDENT_NOT_FOUND', 'Student profile not found');
    }

    const currentYear = await prisma.academicYear.findFirst({
      where: { tenantId, isCurrent: true, isActive: true },
      select: { id: true },
    });

    const enrollmentScope = currentYear ? { academicYearId: currentYear.id } : {};

    const classRows = await prisma.studentEnrollment.findMany({
      where: {
        tenantId,
        studentId: student.id,
        isActive: true,
        ...enrollmentScope,
      },
      select: { classRoomId: true },
      distinct: ['classRoomId'],
    });
    const classIds = classRows.map(r => r.classRoomId).filter(Boolean) as string[];

    const startOfToday = new Date();
    startOfToday.setUTCHours(0, 0, 0, 0);

    const weekAgo = new Date(startOfToday);
    weekAgo.setUTCDate(weekAgo.getUTCDate() - 7);

    const [
      school,
      enrollments,
      pendingAssignments,
      assessments,
      reportCards,
      attRecords,
      conductOpen,
      lessonTimeAgg,
    ] = await prisma.$transaction([
      prisma.school.findUnique({
        where: { tenantId },
        select: { displayName: true, city: true },
      }),
      prisma.studentEnrollment.count({
        where: {
          tenantId,
          studentId: student.id,
          isActive: true,
          ...enrollmentScope,
        },
      }),
      prisma.submission.count({
        where: {
          studentUserId: userId,
          status: 'SUBMITTED',
          assignment: { tenantId },
        },
      }),
      prisma.assessmentAttempt.count({
        where: { studentUserId: userId },
      }),
      prisma.resultSnapshot.count({
        where: { studentId: student.id, status: ResultSnapshotStatus.PUBLISHED },
      }),
      prisma.attendanceRecord.findMany({
        where: {
          tenantId,
          studentId: student.id,
          attendanceDate: { gte: weekAgo },
        },
        select: { status: true },
      }),
      prisma.conductIncident.count({
        where: {
          tenantId,
          studentId: student.id,
          status: 'OPEN',
        },
      }),
      prisma.studentLessonProgress.aggregate({
        where: { tenantId, studentId: student.id },
        _sum: { timeSpentSeconds: true },
        _max: { lastActivityAt: true },
      }),
    ]);

    const scoredAttempts = await prisma.assessmentAttempt.findMany({
      where: {
        tenantId,
        studentUserId: userId,
        status: 'SUBMITTED',
        submittedAt: { not: null },
        maxScore: { gt: 0 },
        autoScore: { not: null },
      },
      select: { autoScore: true, maxScore: true },
      take: 80,
      orderBy: { submittedAt: 'desc' },
    });
    let avgAssessmentScorePercent: number | null = null;
    if (scoredAttempts.length > 0) {
      const pctSum = scoredAttempts.reduce((acc, a) => {
        const m = a.maxScore ?? 0;
        const s = a.autoScore ?? 0;
        return acc + (m > 0 ? (s / m) * 100 : 0);
      }, 0);
      avgAssessmentScorePercent = Math.round(pctSum / scoredAttempts.length);
    }

    const [upcomingExamsRows, announcementsList] = await Promise.all([
      classIds.length
        ? prisma.exam.findMany({
            where: {
              tenantId,
              isActive: true,
              classRoomId: { in: classIds },
              examDate: { gte: startOfToday },
            },
            take: 5,
            orderBy: { examDate: 'asc' },
            include: {
              subject: { select: { name: true } },
              classRoom: { select: { code: true, name: true } },
            },
          })
        : Promise.resolve([]),
      this.announcementsService.listForViewer(tenantId, actor, {
        page: 1,
        pageSize: 3,
        unreadOnly: false,
      }),
    ]);

    const formatRelativeDate = (date: Date): string => {
      const now = new Date();
      const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff > 1 && diff <= 7) return `In ${diff} days`;
      return date.toLocaleDateString();
    };

    let present = 0;
    let absent = 0;
    let late = 0;
    let excused = 0;
    for (const r of attRecords) {
      if (r.status === AttendanceStatus.PRESENT) present += 1;
      else if (r.status === AttendanceStatus.ABSENT) absent += 1;
      else if (r.status === AttendanceStatus.LATE) late += 1;
      else if (r.status === AttendanceStatus.EXCUSED) excused += 1;
    }

    const upcomingExams = (
      upcomingExamsRows as Array<{
        id: string;
        name: string;
        examDate: Date | null;
        subject: { name: string } | null;
        classRoom: { code: string; name: string };
      }>
    ).map(exam => {
      const examDate = exam.examDate ?? new Date();
      return {
        id: exam.id,
        title: exam.name || exam.subject?.name || 'Exam',
        date: examDate.toISOString().split('T')[0],
        time: examDate.toLocaleTimeString('en-US', {
          hour: 'numeric',
          minute: '2-digit',
          hour12: true,
        }),
        relativeDate: formatRelativeDate(examDate),
        classLabel: `${exam.classRoom.code} ${exam.classRoom.name}`.trim(),
        subjectName: exam.subject?.name ?? '—',
      };
    });

    return {
      school: {
        displayName: school?.displayName ?? 'School',
        city: school?.city ?? null,
      },
      metrics: {
        myCourses: enrollments,
        assignmentsSubmitted: pendingAssignments,
        myAssessments: assessments,
        reportCards,
      },
      learningStats: {
        timeSpentSecondsTotal: lessonTimeAgg._sum.timeSpentSeconds ?? 0,
        lastLessonActivityAt: lessonTimeAgg._max.lastActivityAt?.toISOString() ?? null,
        avgAssessmentScorePercent,
      },
      upcomingExams,
      latestReports: [
        { id: 'report-cards', name: 'Published report cards', value: reportCards },
        { id: 'assignments', name: 'Assignments submitted', value: pendingAssignments },
        { id: 'assessments', name: 'Test attempts', value: assessments },
      ],
      recentAnnouncements: announcementsList.items.slice(0, 3).map(a => ({
        id: a.id,
        title: a.title,
        publishedAt: a.publishedAt,
        excerpt: a.body.length > 160 ? `${a.body.slice(0, 157)}…` : a.body,
      })),
      attendanceWeek:
        attRecords.length > 0
          ? {
              daysWithRecords: attRecords.length,
              present,
              absent,
              late,
              excused,
            }
          : null,
      conductOpen: conductOpen > 0 ? conductOpen : null,
    };
  }

  async getTeacherDashboard(actor: JwtUser): Promise<{
    school: { displayName: string; city: string | null };
    metrics: {
      myCourses: number;
      myClasses: number;
      pendingSubmissions: number;
      upcomingExams: number;
    };
    todayAttendance: {
      markedStudents: number;
      pendingClasses: number;
      totalClasses: number;
    };
    todayClasses: Array<{
      classRoomId: string;
      className: string;
      subjectNames: string[];
      totalStudents: number;
      markedStudents: number;
      status: 'COMPLETE' | 'PARTIAL' | 'UNMARKED';
    }>;
    upcomingExams: Array<{
      id: string;
      title: string;
      date: string;
      time: string;
      relativeDate: string;
    }>;
  }> {
    const tenantId = actor.tenantId!;
    const userId = actor.sub;

    const school = await prisma.school.findUnique({
      where: { tenantId },
      select: { displayName: true, city: true },
    });

    const teacherClassRoomIds = await prisma.course.findMany({
      where: { tenantId, teacherUserId: userId, isActive: true },
      select: { classRoomId: true },
      distinct: ['classRoomId'],
    });
    const classIds = teacherClassRoomIds.map(c => c.classRoomId);

    const todayStr = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Kigali',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const todayDate = /^\d{4}-\d{2}-\d{2}$/.test(todayStr)
      ? new Date(`${todayStr}T00:00:00.000Z`)
      : new Date(new Date().toISOString().slice(0, 10) + 'T00:00:00.000Z');

    const [
      myCoursesCount,
      pendingSubmissionsCount,
      upcomingExams,
      totalTeacherClasses,
      sessionsToday,
      recordsToday,
    ] = await prisma.$transaction([
      prisma.course.count({
        where: { tenantId, teacherUserId: userId, isActive: true },
      }),
      prisma.submission.count({
        where: {
          status: 'SUBMITTED',
          assignment: { course: { teacherUserId: userId } },
        },
      }),
      prisma.exam.findMany({
        where: { tenantId, teacherUserId: userId },
        take: 5,
        orderBy: { examDate: 'asc' },
        include: { subject: true, classRoom: true },
      }),
      prisma.classRoom.count({
        where: { id: { in: classIds }, isActive: true },
      }),
      prisma.attendanceSession.count({
        where: {
          tenantId,
          classRoomId: { in: classIds },
          sessionDate: todayDate,
        },
      }),
      prisma.attendanceRecord.count({
        where: {
          tenantId,
          classRoomId: { in: classIds },
          attendanceDate: todayDate,
        },
      }),
    ]);

    const sessionsTodayRows = await prisma.attendanceSession.findMany({
      where: { tenantId, classRoomId: { in: classIds }, sessionDate: todayDate },
      select: { classRoomId: true },
    });
    const classesWithSessions = new Set(sessionsTodayRows.map(r => r.classRoomId));

    const [taughtClasses, recordsByClass, studentsByClass] = await prisma.$transaction([
      prisma.course.findMany({
        where: { tenantId, teacherUserId: userId, isActive: true },
        select: {
          classRoom: { select: { id: true, code: true, name: true } },
          subject: { select: { name: true } },
        },
      }),
      prisma.attendanceRecord.groupBy({
        by: ['classRoomId'],
        where: { tenantId, classRoomId: { in: classIds }, attendanceDate: todayDate },
        _count: { _all: true },
        orderBy: { classRoomId: 'asc' },
      }),
      prisma.studentEnrollment.groupBy({
        by: ['classRoomId'],
        where: { tenantId, classRoomId: { in: classIds }, isActive: true },
        _count: { _all: true },
        orderBy: { classRoomId: 'asc' },
      }),
    ]);

    const recordCounts = new Map(
      recordsByClass.map(r => [r.classRoomId, Number((r as any)._count?._all ?? 0)])
    );
    const studentCounts = new Map(
      studentsByClass.map(r => [r.classRoomId, Number((r as any)._count?._all ?? 0)])
    );
    const classMap = new Map<string, { className: string; subjectNames: string[] }>();

    for (const c of taughtClasses) {
      const roomId = c.classRoom.id;
      const existing = classMap.get(roomId);
      if (existing) {
        if (c.subject?.name) existing.subjectNames.push(c.subject.name);
      } else {
        classMap.set(roomId, {
          className:
            `${c.classRoom.code ?? ''}${c.classRoom.code ? ' · ' : ''}${c.classRoom.name ?? ''}`.trim(),
          subjectNames: c.subject?.name ? [c.subject.name] : [],
        });
      }
    }

    const todayClasses = [...classMap.entries()].map(([classRoomId, info]) => {
      const markedStudents = recordCounts.get(classRoomId) ?? 0;
      const totalStudents = studentCounts.get(classRoomId) ?? 0;
      const hasSession = classesWithSessions.has(classRoomId);
      const status: 'COMPLETE' | 'PARTIAL' | 'UNMARKED' =
        !hasSession || markedStudents === 0
          ? 'UNMARKED'
          : markedStudents >= totalStudents
            ? 'COMPLETE'
            : 'PARTIAL';
      return {
        classRoomId,
        className: info.className,
        subjectNames: info.subjectNames.slice(0, 3),
        totalStudents,
        markedStudents,
        status,
      };
    });

    const formatRelativeDate = (date: Date): string => {
      const now = new Date();
      const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff > 1 && diff <= 7) return `In ${diff} Days`;
      return date.toLocaleDateString();
    };

    return {
      school: {
        displayName: school?.displayName ?? 'School',
        city: school?.city ?? null,
      },
      metrics: {
        myCourses: myCoursesCount,
        myClasses: totalTeacherClasses,
        pendingSubmissions: pendingSubmissionsCount,
        upcomingExams: upcomingExams.length,
      },
      todayAttendance: {
        markedStudents: recordsToday,
        pendingClasses: Math.max(totalTeacherClasses - sessionsToday, 0),
        totalClasses: totalTeacherClasses,
      },
      todayClasses,
      upcomingExams: upcomingExams.slice(0, 3).map(exam => {
        const examDate = exam.examDate ?? exam.createdAt;
        return {
          id: exam.id,
          title: exam.name ?? `${exam.subject?.name ?? 'Exam'}`,
          date: examDate.toISOString().split('T')[0],
          time: examDate.toLocaleTimeString('en-US', {
            hour: 'numeric',
            minute: '2-digit',
            hour12: true,
          }),
          relativeDate: formatRelativeDate(examDate),
        };
      }),
    };
  }

  async getDemographics(actor: JwtUser, filters?: { academicYear?: string; term?: string }) {
    const tenantId = actor.tenantId!;

    const studentsWhere: Prisma.StudentWhereInput = {
      tenantId,
      deletedAt: null,
      isActive: true,
    };

    if (filters?.academicYear) {
      studentsWhere.enrollments = {
        some: {
          academicYearId: filters.academicYear,
          isActive: true,
        },
      };
    }

    const students = await prisma.student.findMany({
      where: studentsWhere,
      select: {
        gender: true,
        hasDisability: true,
        disabilityType: true,
        enrollments: {
          where: { isActive: true },
          select: {
            classRoom: {
              select: { code: true },
            },
            academicYear: {
              select: { name: true },
            },
          },
        },
      },
    });

    let totalBoys = 0;
    let totalGirls = 0;
    let studentsWithDisabilities = 0;
    const disabilityBreakdown: Record<string, number> = {
      visual: 0,
      hearing: 0,
      mobility: 0,
      intellectual: 0,
      other: 0,
    };

    for (const s of students) {
      if (s.gender === 'MALE') totalBoys += 1;
      else if (s.gender === 'FEMALE') totalGirls += 1;

      if (s.hasDisability) {
        studentsWithDisabilities += 1;
        const dt = s.disabilityType?.toLowerCase() ?? 'other';
        if (dt in disabilityBreakdown) {
          disabilityBreakdown[dt] += 1;
        } else {
          disabilityBreakdown.other += 1;
        }
      }
    }

    const sectorMap = new Map<string, { boys: number; girls: number; disabilities: number }>();
    const gradeMap = new Map<string, { boys: number; girls: number; disabilities: number }>();
    const yearMap = new Map<string, { boys: number; girls: number; disabilities: number }>();

    for (const s of students) {
      const sector = s.enrollments[0]?.classRoom?.code ?? 'Unknown';
      const grade = s.enrollments[0]?.classRoom?.code ?? 'Unknown';
      const year = s.enrollments[0]?.academicYear?.name ?? 'Unknown';

      if (!sectorMap.has(sector)) sectorMap.set(sector, { boys: 0, girls: 0, disabilities: 0 });
      if (!gradeMap.has(grade)) gradeMap.set(grade, { boys: 0, girls: 0, disabilities: 0 });
      if (!yearMap.has(year)) yearMap.set(year, { boys: 0, girls: 0, disabilities: 0 });

      const se = sectorMap.get(sector)!;
      const gr = gradeMap.get(grade)!;
      const yr = yearMap.get(year)!;

      if (s.gender === 'MALE') {
        se.boys += 1;
        gr.boys += 1;
        yr.boys += 1;
      } else if (s.gender === 'FEMALE') {
        se.girls += 1;
        gr.girls += 1;
        yr.girls += 1;
      }

      if (s.hasDisability) {
        se.disabilities += 1;
        gr.disabilities += 1;
        yr.disabilities += 1;
      }
    }

    const bySector = Array.from(sectorMap.entries())
      .map(([sector, d]) => ({ sector, ...d }))
      .sort((a, b) => b.boys + b.girls - (a.boys + a.girls));

    const byGrade = Array.from(gradeMap.entries())
      .map(([grade, d]) => ({ grade, ...d }))
      .sort((a, b) => b.boys + b.girls - (a.boys + a.girls));

    const byAcademicYear = Array.from(yearMap.entries())
      .map(([year, d]) => ({ year, ...d }))
      .sort((a, b) => b.year.localeCompare(a.year));

    return {
      totalStudents: students.length,
      totalBoys,
      totalGirls,
      studentsWithDisabilities,
      disabilitiesBreakdown: {
        visual: disabilityBreakdown.visual,
        hearing: disabilityBreakdown.hearing,
        mobility: disabilityBreakdown.mobility,
        intellectual: disabilityBreakdown.intellectual,
        other: disabilityBreakdown.other,
      },
      bySector,
      byGrade,
      byAcademicYear,
    };
  }
}

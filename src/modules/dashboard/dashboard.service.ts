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
}

export class DashboardService {
  private readonly announcementsService = new AnnouncementsService();

  private buildSuperAdminTenantsWhere(
    filters?: { status?: string; region?: string; school?: string },
    regionStrategy: 'province-or-district' | 'district-only' = 'province-or-district',
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
    filters?: { status?: string; region?: string; academicYear?: string; term?: string; school?: string },
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
    filters?: { status?: string; region?: string; academicYear?: string; term?: string; school?: string },
    regionStrategy: 'province-or-district' | 'district-only' = 'province-or-district',
  ): Promise<SuperAdminDashboardData> {
    const tenantsWhere = this.buildSuperAdminTenantsWhere(filters, regionStrategy);

    const userTenantScope = { deletedAt: null, tenant: tenantsWhere };
    const [
      totalUsers,
      activeSchools,
      administratorsCount,
      teachersCount,
      studentsCount,
      parentsCount,
      classesCount,
      subjectsCount,
      assessmentsCount,
      conductCount,
      exams,
    ] = await prisma.$transaction([
      prisma.user.count({
        where: userTenantScope,
      }),
      prisma.tenant.count({
        where: { ...tenantsWhere, school: { setupCompletedAt: { not: null } } },
      }),
      prisma.userRole.count({
        where: {
          user: userTenantScope,
          role: { name: { in: ['SCHOOL_ADMIN', 'SUPER_ADMIN'] } },
        },
      }),
      prisma.userRole.count({
        where: {
          user: userTenantScope,
          role: { name: 'TEACHER' },
        },
      }),
      prisma.student.count({
        where: { deletedAt: null, tenant: tenantsWhere },
      }),
      prisma.parent.count({
        where: { deletedAt: null, tenant: tenantsWhere },
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

    const schoolCount = await prisma.tenant.count({
      where: tenantsWhere,
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
      metrics: {
        totalUsers,
        activeSchools,
        ongoingExams: assessmentsCount,
        supportTickets: 5,
      },
      userOverview: {
        administrators: administratorsCount,
        schools: schoolCount,
        teachers: teachersCount,
        students: studentsCount,
        parents: parentsCount,
        classes: classesCount,
        subjects: subjectsCount,
        activeAccounts: totalUsers,
      },
      upcomingExams: exams.slice(0, 3).map((exam) => {
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
        { id: 'student', name: 'Student Report', count: studentsCount, icon: 'user' },
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
    };
  }

  private buildSuperAdminAnalyticsSeries(
    kind: 'weekly' | 'monthly',
    totals: { logins: number; courses: number; exams: number },
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
        tenants.flatMap((t) => {
          const s = t.school;
          if (!s) return [];
          return [s.province, s.district].filter((v): v is string => Boolean(v));
        }),
      ),
    ).sort();

    return {
      schools: tenants.map((t) => ({
        id: t.id,
        name: t.school?.displayName ?? t.name,
        province: t.school?.province ?? t.school?.district ?? null,
        isActive: t.isActive,
      })),
      regions,
      academicYears: academicYears.map((ay) => ({
        id: ay.id,
        name: ay.name,
      })),
      terms: terms.map((term) => ({
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
      new Set(
        tenants
          .map((t) => t.school?.district)
          .filter((v): v is string => Boolean(v)),
      ),
    ).sort();

    return {
      schools: tenants.map((t) => ({
        id: t.id,
        name: t.school?.displayName ?? t.name,
        province: null,
        isActive: t.isActive,
      })),
      regions,
      academicYears: academicYears.map((ay) => ({
        id: ay.id,
        name: ay.name,
      })),
      terms: terms.map((term) => ({
        id: term.id,
        name: term.name,
        sequence: term.sequence,
      })),
    };
  }

  async getSchoolAdminDashboard(actor: JwtUser): Promise<SchoolAdminDashboardData> {
    const tenantId = actor.tenantId!;

    const tenant = await prisma.tenant.findUnique({
      where: { id: tenantId },
      select: { code: true },
    });
    if (!tenant || tenant.code === 'platform') {
      throw new AppError(403, 'TENANT_NOT_SCHOOL', 'School admin dashboard is not available for platform accounts');
    }

    const weekAgo = new Date(Date.now() - 14 * 24 * 60 * 60 * 1000);

    const [
      school,
      studentsCount,
      teachersCount,
      classesCount,
      subjectsCount,
      parentsCount,
      exams,
      attendanceSessionsThisWeek,
      submissionsCount,
      attendanceSessionsPrevWeek,
      conductIncidentsOpen,
    ] = await prisma.$transaction([
      prisma.school.findUniqueOrThrow({
        where: { tenantId },
        select: { displayName: true, city: true, logoUrl: true },
      }),
      prisma.student.count({
        where: { tenantId, deletedAt: null },
      }),
      prisma.userRole.count({
        where: {
          tenantId,
          role: { name: 'TEACHER' },
          user: { deletedAt: null },
        },
      }),
      prisma.classRoom.count({ where: { tenantId } }),
      prisma.subject.count({ where: { tenantId } }),
      prisma.parent.count({ where: { tenantId, deletedAt: null } }),
      prisma.exam.findMany({
        where: { tenantId },
        take: 5,
        orderBy: { examDate: 'asc' },
        include: { subject: true },
      }),
      prisma.attendanceSession.count({
        where: {
          classRoom: { tenantId },
          createdAt: {
            gte: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.submission.count({
        where: {
          assignment: { tenantId },
          status: 'SUBMITTED',
        },
      }),
      prisma.attendanceSession.count({
        where: {
          classRoom: { tenantId },
          createdAt: {
            gte: weekAgo,
            lt: new Date(Date.now() - 7 * 24 * 60 * 60 * 1000),
          },
        },
      }),
      prisma.conductIncident.count({
        where: {
          tenantId,
          status: { in: ['OPEN', 'UNDER_REVIEW'] },
        },
      }),
    ]);

    const activeAccounts =
      (await prisma.user.count({
        where: { tenantId, deletedAt: null, status: 'ACTIVE' },
      })) +
      (await prisma.student.count({
        where: { tenantId, deletedAt: null },
      }));

    const formatRelativeDate = (date: Date): string => {
      const now = new Date();
      const diff = Math.ceil((date.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
      if (diff === 0) return 'Today';
      if (diff === 1) return 'Tomorrow';
      if (diff > 1 && diff <= 7) return `In ${diff} Days`;
      return date.toLocaleDateString();
    };

    const attendanceDelta = attendanceSessionsThisWeek - attendanceSessionsPrevWeek;

    return {
      school: {
        displayName: school.displayName,
        city: school.city,
        logoUrl: school.logoUrl ?? null,
      },
      metrics: {
        totalStudents: studentsCount,
        studentsChange: 0,
        teachers: teachersCount,
        teachersChange: 0,
        classes: classesCount,
        classesChange: 0,
        subjects: subjectsCount,
      },
      userOverview: {
        students: studentsCount,
        studentsChange: 0,
        teachers: teachersCount,
        teachersChange: 0,
        parents: parentsCount,
        parentsChange: 0,
        activeAccounts,
      },
      upcomingExams: exams.slice(0, 3).map((exam) => {
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
        weekly: this.getSchoolAnalyticsWeekly(attendanceSessionsThisWeek, submissionsCount, attendanceDelta),
        monthly: this.getSchoolAnalyticsMonthly(attendanceSessionsThisWeek, submissionsCount),
      },
    };
  }

  private getSchoolAnalyticsWeekly(
    attendanceSessions: number,
    submissions: number,
    attendanceDelta: number,
  ) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((label, i) => ({
      label,
      logins: 55 + ((attendanceSessions + i * 3) % 40),
      attendance: Math.max(0, Math.floor(attendanceSessions / 7) + (i % 4) + (attendanceDelta >= 0 ? 0 : -1)),
      assignments: Math.max(0, Math.floor(submissions / 14) + (i % 5)),
    }));
  }

  private getSchoolAnalyticsMonthly(
    attendanceSessions: number,
    submissions: number,
  ) {
    const labels = ['W1', 'W2', 'W3', 'W4'];
    return labels.map((label, i) => ({
      label,
      logins: 220 + attendanceSessions + i * 12,
      attendance: Math.max(0, Math.floor(attendanceSessions / 2) + i * 3),
      assignments: Math.max(0, Math.floor(submissions / 4) + i * 2),
    }));
  }

  async getStudentDashboard(actor: JwtUser): Promise<{
    school: { displayName: string; city: string | null };
    metrics: {
      myCourses: number;
      assignmentsSubmitted: number;
      myAssessments: number;
      reportCards: number;
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

    const enrollmentScope = currentYear
      ? { academicYearId: currentYear.id }
      : {};

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
    const classIds = classRows.map((r) => r.classRoomId).filter(Boolean) as string[];

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
    ]);

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
      this.announcementsService.listForStudent(tenantId, student.id, {
        page: 1,
        pageSize: 3,
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

    const upcomingExams = (upcomingExamsRows as Array<{
      id: string;
      name: string;
      examDate: Date | null;
      subject: { name: string } | null;
      classRoom: { code: string; name: string };
    }>).map((exam) => {
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
      upcomingExams,
      latestReports: [
        { id: 'report-cards', name: 'Published report cards', value: reportCards },
        { id: 'assignments', name: 'Assignments submitted', value: pendingAssignments },
        { id: 'assessments', name: 'Test attempts', value: assessments },
      ],
      recentAnnouncements: announcementsList.items.slice(0, 3).map((a) => ({
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
    upcomingExams: Array<{ id: string; title: string; date: string; time: string; relativeDate: string }>;
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
    const classIds = teacherClassRoomIds.map((c) => c.classRoomId);

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
      upcomingExams: upcomingExams.slice(0, 3).map((exam) => {
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
}

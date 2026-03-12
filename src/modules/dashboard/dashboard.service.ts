import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser } from '../../common/types/auth.types';
import { prisma } from '../../db/prisma';

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
  async getSuperAdminDashboard(_actor: JwtUser): Promise<SuperAdminDashboardData> {
    const tenantsWhere: Prisma.TenantWhereInput = {
      code: { not: 'platform' },
      isActive: true,
    };

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
        where: {
          deletedAt: null,
          tenant: { code: { not: 'platform' } },
        },
      }),
      prisma.tenant.count({
        where: { ...tenantsWhere, school: { setupCompletedAt: { not: null } } },
      }),
      prisma.userRole.count({
        where: {
          user: {
            deletedAt: null,
            tenant: { code: { not: 'platform' } },
          },
          role: { name: { in: ['SCHOOL_ADMIN', 'SUPER_ADMIN'] } },
        },
      }),
      prisma.userRole.count({
        where: {
          user: { deletedAt: null },
          role: { name: 'TEACHER' },
        },
      }),
      prisma.student.count({
        where: { deletedAt: null },
      }),
      prisma.parent.count({
        where: { deletedAt: null },
      }),
      prisma.classRoom.count(),
      prisma.subject.count(),
      prisma.assessment.count({
        where: { isPublished: true },
      }),
      prisma.conductIncident.count(),
      prisma.exam.findMany({
        where: { tenant: { code: { not: 'platform' } } },
        take: 5,
        orderBy: { examDate: 'asc' },
        include: {
          subject: true,
          classRoom: true,
        },
      }),
    ]);

    const schoolCount = await prisma.tenant.count({
      where: { code: { not: 'platform' } },
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
        weekly: this.getMockAnalyticsWeekly(),
        monthly: this.getMockAnalyticsMonthly(),
      },
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
    ] = await prisma.$transaction([
      prisma.school.findUniqueOrThrow({
        where: { tenantId },
        select: { displayName: true, city: true },
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

    return {
      school: {
        displayName: school.displayName,
        city: school.city,
      },
      metrics: {
        totalStudents: studentsCount,
        studentsChange: 15,
        teachers: teachersCount,
        teachersChange: 3,
        classes: classesCount,
        classesChange: -1,
        subjects: subjectsCount,
      },
      userOverview: {
        students: studentsCount,
        studentsChange: 15,
        teachers: teachersCount,
        teachersChange: 3,
        parents: parentsCount,
        parentsChange: 1,
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
        { id: 'attendance', name: 'Attendance Report', value: '94%', icon: 'check' },
        { id: 'assignment', name: 'Assignment', value: submissionsCount, icon: 'document' },
        { id: 'activity', name: 'Activity Logs', value: 142, icon: 'grid' },
      ],
      systemAnalytics: {
        weekly: this.getMockSchoolAnalyticsWeekly(
          attendanceSessionsThisWeek,
          submissionsCount,
        ),
        monthly: this.getMockSchoolAnalyticsMonthly(
          attendanceSessionsThisWeek,
          submissionsCount,
        ),
      },
    };
  }

  private getMockAnalyticsWeekly() {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((label, i) => ({
      label,
      logins: Math.floor(20 + Math.random() * 80),
      courses: Math.floor(10 + Math.random() * 60),
      exams: Math.floor(5 + Math.random() * 40),
    }));
  }

  private getMockAnalyticsMonthly() {
    return Array.from({ length: 12 }, (_, i) => ({
      label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
      logins: Math.floor(50 + Math.random() * 100),
      courses: Math.floor(30 + Math.random() * 70),
      exams: Math.floor(20 + Math.random() * 50),
    }));
  }

  private getMockSchoolAnalyticsWeekly(
    attendance: number,
    assignments: number,
  ) {
    const days = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    return days.map((label, i) => ({
      label,
      logins: Math.floor(50 + Math.random() * 100),
      attendance: Math.floor(attendance / 7) + Math.floor(Math.random() * 20),
      assignments: Math.floor(assignments / 7) + Math.floor(Math.random() * 10),
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
    upcomingExams: Array<{ id: string; title: string; date: string; time: string; relativeDate: string }>;
    latestReports: Array<{ id: string; name: string; value: string | number }>;
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

    const [school, enrollments, pendingAssignments, assessments, reportCards, exams] =
      await prisma.$transaction([
        prisma.school.findUnique({
          where: { tenantId },
          select: { displayName: true, city: true },
        }),
        prisma.studentEnrollment.count({
          where: { studentId: student.id },
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
          where: { studentId: student.id },
        }),
        prisma.exam.findMany({
          where: { tenantId },
          take: 5,
          orderBy: { examDate: 'asc' },
          include: { subject: true },
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
        myCourses: enrollments,
        assignmentsSubmitted: pendingAssignments,
        myAssessments: assessments,
        reportCards,
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
        { id: 'report-cards', name: 'Report Cards', value: reportCards },
        { id: 'assignments', name: 'Assignments Submitted', value: pendingAssignments },
        { id: 'assessments', name: 'Assessments', value: assessments },
      ],
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

  private getMockSchoolAnalyticsMonthly(
    attendance: number,
    assignments: number,
  ) {
    return Array.from({ length: 12 }, (_, i) => ({
      label: ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'][i],
      logins: Math.floor(100 + Math.random() * 200),
      attendance: Math.floor(attendance * 4) + Math.floor(Math.random() * 50),
      assignments: Math.floor(assignments * 4) + Math.floor(Math.random() * 30),
    }));
  }
}

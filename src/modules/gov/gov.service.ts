import { Prisma } from '@prisma/client';
import { z } from 'zod';

import { JwtUser } from '../../common/types/auth.types';
import { prisma } from '../../db/prisma';
import { AppError } from '../../common/errors/app-error';
import { isProtectedPdfAsset } from '../../common/utils/protected-attachment';
import { getDistricts } from '../../utils/rwanda-locations';
import { buildAuditReportPdfBuffer } from './audit-report-pdf';
import {
  submitAcademicAuditSchema,
  academicAuditQuerySchema,
  updateAcademicAuditSchema,
  reviewAcademicAuditSchema,
  reopenAcademicAuditSchema,
  AcademicAuditAttachmentUploadInput,
} from './gov.schemas';

type SubmitAcademicAuditInput = z.infer<typeof submitAcademicAuditSchema>;
type AcademicAuditQueryInput = z.infer<typeof academicAuditQuerySchema>;
type UpdateAcademicAuditInput = z.infer<typeof updateAcademicAuditSchema>;
type ReviewAcademicAuditInput = z.infer<typeof reviewAcademicAuditSchema>;
type ReopenAcademicAuditInput = z.infer<typeof reopenAcademicAuditSchema>;

type AuditorScope = {
  level: 'NATIONAL' | 'PROVINCE' | 'DISTRICT' | 'SECTOR';
  country: string;
  province: string | null;
  district: string | null;
  sector: string | null;
};

type HierarchicalAccess = {
  canView: boolean;
  canReview: boolean;
  canApprove: boolean;
  accessibleSchoolIds: string[];
  subordinateAuditorIds: string[];
};

export class GovService {
  async getAuditorScope(user: JwtUser) {
    const now = new Date();
    const activeScope = await prisma.govAuditorScope.findFirst({
      where: {
        auditorUserId: user.sub,
        isActive: true,
        AND: [
          { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
          { OR: [{ endsAt: null }, { endsAt: { gte: now } }] },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });

    if (activeScope) {
      return {
        level: this.mapGovScopeLevel(activeScope.scopeLevel),
        country: activeScope.country,
        province: activeScope.province,
        district: activeScope.district,
        sector: activeScope.sector,
      };
    }

    const hasAssignedScopeRecord = await prisma.govAuditorScope.findFirst({
      where: { auditorUserId: user.sub },
      select: { id: true },
    });

    if (hasAssignedScopeRecord) {
      throw new AppError(
        403,
        'GOV_SCOPE_NOT_ASSIGNED',
        'Auditor has no active assigned school scope.'
      );
    }

    const auditor = await prisma.auditor.findUnique({
      where: { userId: user.sub },
    });

    if (!auditor || !auditor.isActive) {
      throw new AppError(
        403,
        'GOV_SCOPE_NOT_ASSIGNED',
        'Auditor has no active assigned school scope.'
      );
    }

    return {
      level: auditor.level,
      country: auditor.country,
      province: auditor.province,
      district: auditor.district,
      sector: auditor.sector,
    };
  }

  private mapGovScopeLevel(scopeLevel: string): AuditorScope['level'] {
    const mapping: Record<string, AuditorScope['level']> = {
      COUNTRY: 'NATIONAL',
      PROVINCE: 'PROVINCE',
      DISTRICT: 'DISTRICT',
      SECTOR: 'SECTOR',
    };
    return mapping[scopeLevel] ?? 'NATIONAL';
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
      const provinceDistricts = getDistricts(scope.province);
      where.OR = [
        { province: scope.province },
        ...(provinceDistricts.length ? [{ district: { in: provinceDistricts } }] : []),
      ];
    }

    return where;
  }

  private async getSchoolIdsInScope(scope: AuditorScope) {
    const schools = await prisma.school.findMany({
      where: this.buildSchoolWhereFromScope(scope),
      select: { id: true },
    });

    return schools.map(s => s.id);
  }

  private async getSchoolInAssignedScope(user: JwtUser, schoolId: string) {
    const scope = await this.getAuditorScope(user);
    const school = await prisma.school.findFirst({
      where: {
        id: schoolId,
        ...this.buildSchoolWhereFromScope(scope),
      },
      include: {
        tenant: true,
      },
    });

    if (!school) {
      throw new AppError(
        403,
        'SCHOOL_OUT_OF_SCOPE',
        'School is outside your assigned audit scope.'
      );
    }

    return school;
  }

  private async getSchoolsForTenant(tenantId: string) {
    const schools = await prisma.school.findMany({
      where: { tenantId },
      select: { id: true },
    });

    return schools.map((school) => school.id);
  }

  /**
   * Determines hierarchical access permissions for a user
   */
  private async getHierarchicalAccess(user: JwtUser): Promise<HierarchicalAccess> {
    const roles = user.roles ?? [];
    const isSuperAdmin = roles.includes('SUPER_ADMIN');
    const isGovAuditor = roles.includes('GOV_AUDITOR');
    const isSchoolAdmin = roles.includes('SCHOOL_ADMIN');
    const isTenantAdmin = roles.includes('ADMIN');
    const isDirector = roles.includes('DIRECTOR');

    if (isSuperAdmin) {
      const [allSchools, allAuditors] = await Promise.all([
        prisma.school.findMany({ select: { id: true } }),
        prisma.auditor.findMany({ select: { userId: true } }),
      ]);

      return {
        canView: true,
        canReview: true,
        canApprove: true,
        accessibleSchoolIds: allSchools.map((s) => s.id),
        subordinateAuditorIds: allAuditors.map((a) => a.userId),
      };
    }

    if (isDirector || isSchoolAdmin || isTenantAdmin) {
      // School/tenant-side roles are the audited party: they may view audits about their own
      // school, but must not review/approve/reopen them — that stays with independent
      // government auditors (PROVINCE/NATIONAL scope) and SUPER_ADMIN, to avoid the audited
      // school being able to dismiss or bounce back findings about itself.
      const accessibleSchoolIds = await this.getSchoolsForTenant(user.tenantId);
      return {
        canView: true,
        canReview: false,
        canApprove: false,
        accessibleSchoolIds,
        subordinateAuditorIds: [],
      };
    }

    if (isGovAuditor) {
      const scope = await this.getAuditorScope(user);
      const [accessibleSchoolIds, subordinateAuditors] = await Promise.all([
        this.getSchoolIdsInScope(scope),
        this.getSubordinateAuditors(scope),
      ]);

      return {
        canView: true,
        canReview: this.canReviewAudits(scope),
        canApprove: this.canApproveAudits(scope),
        accessibleSchoolIds,
        subordinateAuditorIds: subordinateAuditors.map((a) => a.userId),
      };
    }

    return {
      canView: false,
      canReview: false,
      canApprove: false,
      accessibleSchoolIds: [],
      subordinateAuditorIds: [],
    };
  }

  /**
   * Get auditors who report to this auditor (subordinates)
   */
  private async getSubordinateAuditors(scope: AuditorScope): Promise<{ userId: string; level: string }[]> {
    const where: Prisma.AuditorWhereInput = { isActive: true };

    switch (scope.level) {
      case 'NATIONAL':
        break;
      case 'PROVINCE':
        where.OR = [
          { level: 'DISTRICT', province: scope.province },
          { level: 'SECTOR', province: scope.province },
        ];
        break;
      case 'DISTRICT':
        where.level = 'SECTOR';
        where.district = scope.district;
        break;
      case 'SECTOR':
        return [];
    }

    const auditors = await prisma.auditor.findMany({
      where,
      select: { userId: true, level: true },
    });

    return auditors;
  }

  private canReviewAudits(scope: AuditorScope): boolean {
    return scope.level === 'NATIONAL' || scope.level === 'PROVINCE';
  }

  private canApproveAudits(scope: AuditorScope): boolean {
    return scope.level === 'NATIONAL';
  }

  private async assertSchoolAccessible(user: JwtUser, schoolId: string) {
    const access = await this.getHierarchicalAccess(user);
    if (!access.accessibleSchoolIds.includes(schoolId)) {
      throw new AppError(403, 'SCHOOL_OUT_OF_SCOPE', 'School is outside your accessible audit scope.');
    }
  }

  private async buildAuditWhereForUser(
    user: JwtUser,
    query: AcademicAuditQueryInput
  ): Promise<Prisma.AcademicAuditWhereInput> {
    const access = await this.getHierarchicalAccess(user);
    if (!access.canView) {
      throw new AppError(403, 'AUDIT_ACCESS_DENIED', 'User cannot view audit reports.');
    }

    const conditions: Prisma.AcademicAuditWhereInput[] = [
      { auditorId: user.sub },
      ...(access.subordinateAuditorIds.length > 0 ? [{ auditorId: { in: access.subordinateAuditorIds } }] : []),
      ...(access.accessibleSchoolIds.length > 0 ? [{ schoolId: { in: access.accessibleSchoolIds } }] : []),
    ];

    const where: Prisma.AcademicAuditWhereInput = {
      OR: conditions,
    };

    const filters: Prisma.AcademicAuditWhereInput[] = [];

    if (query.schoolId) {
      await this.assertSchoolAccessible(user, query.schoolId);
      filters.push({ schoolId: query.schoolId });
    }

    if (query.auditorId) {
      filters.push({ auditorId: query.auditorId });
    }

    if (query.module) {
      filters.push({ module: query.module });
    }

    if (query.status) {
      filters.push({ status: query.status });
    }

    if (query.from || query.to) {
      filters.push({
        createdAt: {
          ...(query.from ? { gte: query.from } : {}),
          ...(query.to ? { lte: query.to } : {}),
        },
      });
    }

    if (query.province || query.district || query.sector) {
      filters.push({
        school: {
          ...(query.province ? { province: query.province } : {}),
          ...(query.district ? { district: query.district } : {}),
          ...(query.sector ? { sector: query.sector } : {}),
        },
      });
    }

    if (filters.length > 0) {
      where.AND = filters;
    }

    return where;
  }

  private async canAccessAudit(user: JwtUser, auditId: string): Promise<boolean> {
    const access = await this.getHierarchicalAccess(user);

    if (!access.canView) {
      return false;
    }

    const audit = await prisma.academicAudit.findFirst({
      where: {
        id: auditId,
        OR: [
          { auditorId: user.sub },
          ...(access.subordinateAuditorIds.length > 0 ? [{ auditorId: { in: access.subordinateAuditorIds } }] : []),
          ...(access.accessibleSchoolIds.length > 0 ? [{ schoolId: { in: access.accessibleSchoolIds } }] : []),
        ],
      },
      select: { id: true },
    });

    return !!audit;
  }

  async listSchoolsInScope(user: JwtUser) {
    const scope = await this.getAuditorScope(user);

    const schools = await prisma.school.findMany({
      where: this.buildSchoolWhereFromScope(scope),
      select: {
        id: true,
        displayName: true,
        registrationNumber: true,
        province: true,
        district: true,
        sector: true,
        tenant: {
          select: {
            id: true,
            code: true,
          },
        },
      },
      orderBy: {
        displayName: 'asc',
      },
    });

    return schools;
  }

  async getSchoolAttendanceData(user: JwtUser, schoolId: string) {
    const school = await this.getSchoolInAssignedScope(user, schoolId);
    const academicYear = await prisma.academicYear.findFirst({
      where: {
        tenantId: school.tenantId,
        isActive: true,
      },
      orderBy: { startDate: 'desc' },
    });

    if (!academicYear) {
      return {
        school: { id: school.id, displayName: school.displayName },
        summary: { totalSessions: 0, averageAttendance: 0 },
        data: [],
      };
    }

    const sessions = await prisma.attendanceSession.findMany({
      where: {
        tenantId: school.tenantId,
        academicYearId: academicYear.id,
      },
      include: {
        classRoom: {
          select: {
            name: true,
            code: true,
          },
        },
      },
      orderBy: { sessionDate: 'desc' },
      take: 50,
    });

    const attendanceCounts = await Promise.all(
      sessions.map(async session => {
        const [records, present] = await Promise.all([
          prisma.attendanceRecord.count({ where: { sessionId: session.id } }),
          prisma.attendanceRecord.count({ where: { sessionId: session.id, status: 'PRESENT' } }),
        ]);

        return { sessionId: session.id, records, present };
      })
    );

    const totals = attendanceCounts.reduce(
      (acc, item) => ({
        records: acc.records + item.records,
        present: acc.present + item.present,
      }),
      { records: 0, present: 0 }
    );

    const averageAttendance = totals.records > 0 ? Math.round((totals.present / totals.records) * 100) : 0;

    return {
      school: { id: school.id, displayName: school.displayName },
      academicYear: academicYear ? { id: academicYear.id, name: academicYear.name } : null,
      summary: { totalSessions: sessions.length, averageAttendance },
      data: sessions.slice(0, 20).map(s => ({
        id: s.id,
        date: s.sessionDate.toISOString(),
        classRoom: s.classRoom.name || s.classRoom.code,
        status: s.status,
      })),
    };
  }

  async getSchoolCoursesData(user: JwtUser, schoolId: string) {
    const school = await this.getSchoolInAssignedScope(user, schoolId);
    const courses = await prisma.course.findMany({
      where: {
        tenantId: school.tenantId,
      },
      include: {
        subject: true,
        classRoom: true,
        teacherUser: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        _count: {
          select: {
            lessons: true,
            assignments: true,
          },
        },
      },
      take: 50,
    });

    return {
      school: { id: school.id, displayName: school.displayName },
      totalCourses: courses.length,
      data: courses.map(c => ({
        id: c.id,
        name: c.title,
        subject: c.subject?.name || 'N/A',
        classRoom: c.classRoom?.name || 'N/A',
        teacher: `${c.teacherUser.firstName} ${c.teacherUser.lastName}`.trim(),
        lessonsCount: c._count.lessons,
        assignmentsCount: c._count.assignments,
        isPublished: c.isActive,
      })),
    };
  }

  async getSchoolLearningInsightsData(user: JwtUser, schoolId: string) {
    const school = await this.getSchoolInAssignedScope(user, schoolId);
    const academicYear = await prisma.academicYear.findFirst({
      where: {
        tenantId: school.tenantId,
        isActive: true,
      },
      orderBy: { startDate: 'desc' },
    });

    const studentsCount = await prisma.student.count({
      where: {
        tenantId: school.tenantId,
        deletedAt: null,
      },
    });

    const coursesCount = await prisma.course.count({
      where: {
        tenantId: school.tenantId,
      },
    });

    const activeEnrollments = await prisma.studentEnrollment.count({
      where: {
        tenantId: school.tenantId,
        isActive: true,
        ...(academicYear && { academicYearId: academicYear.id }),
      },
    });

    const completedLessons = await prisma.studentLessonProgress.count({
      where: {
        student: {
          tenantId: school.tenantId,
        },
        completedAt: { not: null },
      },
    });

    return {
      school: { id: school.id, displayName: school.displayName },
      academicYear: academicYear ? { id: academicYear.id, name: academicYear.name } : null,
      summary: {
        totalStudents: studentsCount,
        totalCourses: coursesCount,
        activeEnrollments,
        completedLessons,
      },
    };
  }

  async getSchoolAssessmentsData(user: JwtUser, schoolId: string) {
    const school = await this.getSchoolInAssignedScope(user, schoolId);
    const assessments = await prisma.assessment.findMany({
      where: {
        tenantId: school.tenantId,
      },
      include: {
        createdByUser: {
          select: {
            firstName: true,
            lastName: true,
          },
        },
        _count: {
          select: {
            questions: true,
            attempts: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const totalAttempts = assessments.reduce((sum, assessment) => sum + assessment._count.attempts, 0);

    return {
      school: { id: school.id, displayName: school.displayName },
      totalAssessments: assessments.length,
      totalAttempts,
      data: assessments.map(a => ({
        id: a.id,
        title: a.title,
        type: a.type,
        status: a.isPublished ? 'PUBLISHED' : 'DRAFT',
        duration: a.timeLimitMinutes,
        questionsCount: a._count.questions,
        attemptsCount: a._count.attempts,
        createdBy: a.createdByUser ? `${a.createdByUser.firstName} ${a.createdByUser.lastName}` : 'N/A',
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }

  async getSchoolMarksData(user: JwtUser, schoolId: string) {
    const school = await this.getSchoolInAssignedScope(user, schoolId);
    const academicYear = await prisma.academicYear.findFirst({
      where: {
        tenantId: school.tenantId,
        isActive: true,
      },
      orderBy: { startDate: 'desc' },
    });

    const exams = await prisma.exam.findMany({
      where: {
        tenantId: school.tenantId,
      },
      include: {
        subject: true,
        classRoom: true,
        _count: {
          select: {
            marks: true,
          },
        },
      },
      orderBy: { createdAt: 'desc' },
      take: 30,
    });

    const expectedMarkCounts = await Promise.all(
      exams.map(exam =>
        prisma.studentEnrollment.count({
          where: {
            tenantId: school.tenantId,
            academicYearId: exam.academicYearId,
            classRoomId: exam.classRoomId,
            isActive: true,
          },
        })
      )
    );

    const totalExpectedMarks = expectedMarkCounts.reduce((sum, count) => sum + count, 0);
    const totalEnteredMarks = exams.reduce((sum, exam) => sum + exam._count.marks, 0);
    const marksCompletionRate =
      totalExpectedMarks > 0 ? Math.round((totalEnteredMarks / totalExpectedMarks) * 100) : 0;

    return {
      school: { id: school.id, displayName: school.displayName },
      academicYear: academicYear ? { id: academicYear.id, name: academicYear.name } : null,
      summary: {
        totalExams: exams.length,
        marksCompletionRate,
      },
      data: exams.map(e => ({
        id: e.id,
        title: e.name,
        subject: e.subject?.name || 'N/A',
        classRoom: e.classRoom?.name || 'N/A',
        examType: e.assessmentType || e.examType,
        totalMarks: e.totalMarks,
        marksEntered: e._count.marks,
        status: e.isActive ? 'ACTIVE' : 'INACTIVE',
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async getSchoolTimetableData(user: JwtUser, schoolId: string) {
    const school = await this.getSchoolInAssignedScope(user, schoolId);
    const academicYear = await prisma.academicYear.findFirst({
      where: {
        tenantId: school.tenantId,
        isActive: true,
      },
      orderBy: { startDate: 'desc' },
    });

    const slots = await prisma.timetableSlot.findMany({
      where: {
        tenantId: school.tenantId,
        ...(academicYear && { academicYearId: academicYear.id }),
      },
      orderBy: [{ dayOfWeek: 'asc' }, { startTime: 'asc' }],
      take: 100,
    });

    const dayNames = ['MONDAY', 'TUESDAY', 'WEDNESDAY', 'THURSDAY', 'FRIDAY', 'SATURDAY', 'SUNDAY'];

    return {
      school: { id: school.id, displayName: school.displayName },
      academicYear: academicYear ? { id: academicYear.id, name: academicYear.name } : null,
      term: null,
      totalSlots: slots.length,
      data: slots.map(t => ({
        id: t.id,
        dayOfWeek: dayNames[t.dayOfWeek] || 'UNKNOWN',
        startTime: t.startTime,
        endTime: t.endTime,
        classRoom: 'N/A',
        subject: 'N/A',
        teacher: 'N/A',
      })),
    };
  }

  async submitAcademicAudit(user: JwtUser, input: SubmitAcademicAuditInput) {
    const school = await this.getSchoolInAssignedScope(user, input.schoolId);

    const attachmentAssetIds = await this.upsertAuditAttachmentAssets(
      school.tenantId,
      input.attachments,
      user.sub
    );

    const asDraft = input.asDraft;

    const audit = await prisma.academicAudit.create({
      data: {
        auditorId: user.sub,
        schoolId: input.schoolId,
        tenantId: school.tenantId,
        module: input.module,
        subType: input.module,
        score: input.score,
        comment: input.comment,
        recommendation: input.recommendation || null,
        status: asDraft ? 'DRAFT' : 'SUBMITTED',
        submittedAt: asDraft ? null : new Date(),
        attachments: attachmentAssetIds.length
          ? { create: attachmentAssetIds.map(fileAssetId => ({ tenantId: school.tenantId, fileAssetId })) }
          : undefined,
      },
      include: { attachments: { include: { fileAsset: true } } },
    });

    if (!asDraft) {
      await this.notifySchoolAdmin(school, input.module, audit.id);
    }

    return this.mapAuditAttachments(audit);
  }

  async updateAcademicAudit(user: JwtUser, auditId: string, input: UpdateAcademicAuditInput) {
    const audit = await prisma.academicAudit.findFirst({ where: { id: auditId } });
    if (!audit) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
    }
    if (audit.auditorId !== user.sub) {
      throw new AppError(403, 'AUDIT_ACCESS_DENIED', 'You can only edit your own audit reports');
    }
    if (audit.status !== 'DRAFT' && audit.status !== 'NEEDS_REVISION') {
      throw new AppError(
        409,
        'AUDIT_NOT_EDITABLE',
        'Only draft or returned-for-revision audits can be edited'
      );
    }

    const attachmentAssetIds =
      input.attachments !== undefined
        ? await this.upsertAuditAttachmentAssets(audit.tenantId, input.attachments, user.sub)
        : undefined;

    return prisma.academicAudit.update({
      where: { id: auditId },
      data: {
        ...(input.score !== undefined && { score: input.score }),
        ...(input.comment !== undefined && { comment: input.comment }),
        ...(input.recommendation !== undefined && { recommendation: input.recommendation }),
        ...(attachmentAssetIds !== undefined && {
          attachments: {
            deleteMany: {},
            create: attachmentAssetIds.map(fileAssetId => ({ tenantId: audit.tenantId, fileAssetId })),
          },
        }),
      },
      include: { attachments: { include: { fileAsset: true } } },
    }).then(updated => this.mapAuditAttachments(updated));
  }

  private mapAuditAttachments<T extends { attachments: Array<{ fileAsset: { id: string; originalName: string; mimeType: string | null; bytes: number | null; secureUrl: string } }> }>(
    audit: T
  ) {
    return {
      ...audit,
      attachments: audit.attachments.map(a => ({
        id: a.fileAsset.id,
        originalName: a.fileAsset.originalName,
        mimeType: a.fileAsset.mimeType,
        bytes: a.fileAsset.bytes,
        secureUrl: isProtectedPdfAsset(a.fileAsset.mimeType) ? null : a.fileAsset.secureUrl,
      })),
    };
  }

  async submitDraftAudit(user: JwtUser, auditId: string) {
    const audit = await prisma.academicAudit.findFirst({
      where: { id: auditId },
      include: { school: { select: { id: true, displayName: true, tenantId: true } } },
    });
    if (!audit) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
    }
    if (audit.auditorId !== user.sub) {
      throw new AppError(403, 'AUDIT_ACCESS_DENIED', 'You can only submit your own audit reports');
    }
    if (audit.status !== 'DRAFT' && audit.status !== 'NEEDS_REVISION') {
      throw new AppError(409, 'AUDIT_NOT_SUBMITTABLE', 'Only draft or returned audits can be submitted');
    }
    if (!audit.comment) {
      throw new AppError(400, 'AUDIT_COMMENT_REQUIRED', 'Add findings before submitting');
    }

    const updated = await prisma.academicAudit.update({
      where: { id: auditId },
      data: { status: 'SUBMITTED', submittedAt: new Date() },
    });

    await this.notifySchoolAdmin(audit.school, audit.module, audit.id);

    return updated;
  }

  async reviewAcademicAudit(user: JwtUser, auditId: string, input: ReviewAcademicAuditInput) {
    const access = await this.getHierarchicalAccess(user);
    const audit = await prisma.academicAudit.findFirst({ where: { id: auditId } });
    if (!audit || !access.accessibleSchoolIds.includes(audit.schoolId)) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
    }
    if (audit.status !== 'SUBMITTED' && audit.status !== 'UNDER_REVIEW') {
      throw new AppError(409, 'AUDIT_NOT_UNDER_REVIEW', 'This audit is not awaiting review');
    }

    if (input.decision === 'APPROVED' && !access.canApprove) {
      throw new AppError(403, 'AUDIT_APPROVAL_DENIED', 'You are not authorized to approve audits');
    }
    if (input.decision !== 'APPROVED' && !access.canReview) {
      throw new AppError(403, 'AUDIT_REVIEW_DENIED', 'You are not authorized to review audits');
    }

    return prisma.academicAudit.update({
      where: { id: auditId },
      data: {
        status: input.decision,
        reviewNote: input.reviewNote ?? null,
        reviewedAt: new Date(),
        reviewedById: user.sub,
      },
    });
  }

  /** Authorized administrator override: send an already-decided audit back to the auditor for edits. */
  async reopenAcademicAudit(user: JwtUser, auditId: string, input: ReopenAcademicAuditInput) {
    const access = await this.getHierarchicalAccess(user);
    if (!access.canApprove) {
      throw new AppError(403, 'AUDIT_REOPEN_DENIED', 'Only an authorized administrator can reopen audits');
    }

    const audit = await prisma.academicAudit.findFirst({ where: { id: auditId } });
    if (!audit || !access.accessibleSchoolIds.includes(audit.schoolId)) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
    }
    if (audit.status !== 'APPROVED' && audit.status !== 'REJECTED') {
      throw new AppError(409, 'AUDIT_NOT_REOPENABLE', 'Only approved or rejected audits can be reopened');
    }

    return prisma.academicAudit.update({
      where: { id: auditId },
      data: {
        status: 'NEEDS_REVISION',
        reviewNote: input.reviewNote ?? audit.reviewNote,
        reviewedAt: new Date(),
        reviewedById: user.sub,
      },
    });
  }

  async getAuditReportPdf(user: JwtUser, auditId: string) {
    const canView = await this.canAccessAudit(user, auditId);
    if (!canView) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
    }

    const audit = await prisma.academicAudit.findUnique({
      where: { id: auditId },
      include: {
        school: { select: { displayName: true, province: true, district: true, sector: true } },
        auditor: { select: { firstName: true, lastName: true, email: true } },
        reviewedBy: { select: { firstName: true, lastName: true } },
        attachments: { include: { fileAsset: { select: { originalName: true } } } },
      },
    });

    if (!audit) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
    }

    const buffer = await buildAuditReportPdfBuffer({
      id: audit.id,
      module: audit.module,
      status: audit.status,
      score: audit.score,
      comment: audit.comment,
      recommendation: audit.recommendation,
      reviewNote: audit.reviewNote,
      school: audit.school,
      auditor: audit.auditor,
      reviewedBy: audit.reviewedBy,
      submittedAt: audit.submittedAt?.toISOString() ?? null,
      reviewedAt: audit.reviewedAt?.toISOString() ?? null,
      createdAt: audit.createdAt.toISOString(),
      attachments: audit.attachments.map(a => ({ originalName: a.fileAsset.originalName })),
    });

    return { buffer, fileName: `audit-report-${audit.id}.pdf` };
  }

  private async upsertAuditAttachmentAssets(
    tenantId: string,
    uploads: AcademicAuditAttachmentUploadInput[],
    uploadedByUserId: string
  ): Promise<string[]> {
    if (!uploads.length) {
      return [];
    }

    const assets = await Promise.all(
      uploads.map(asset =>
        prisma.fileAsset.upsert({
          where: { tenantId_publicId: { tenantId, publicId: asset.publicId } },
          update: {
            secureUrl: asset.secureUrl,
            originalName: asset.originalName,
            bytes: asset.bytes,
            format: asset.format,
            mimeType: asset.mimeType,
            resourceType: asset.resourceType,
          },
          create: {
            tenantId,
            uploadedByUserId,
            publicId: asset.publicId,
            secureUrl: asset.secureUrl,
            originalName: asset.originalName,
            bytes: asset.bytes,
            format: asset.format,
            mimeType: asset.mimeType,
            resourceType: asset.resourceType,
          },
        })
      )
    );

    return assets.map(a => a.id);
  }

  private async notifySchoolAdmin(school: { id: string; displayName: string; tenantId: string }, module: string, auditId: string) {
    const adminUsers = await prisma.user.findMany({
      where: {
        tenantId: school.tenantId,
        deletedAt: null,
        status: 'ACTIVE',
        userRoles: {
          some: {
            role: {
              name: 'SCHOOL_ADMIN',
            },
          },
        },
      },
      select: {
        email: true,
        firstName: true,
        lastName: true,
      },
    });

    for (const admin of adminUsers) {
      console.log(`[AUDIT NOTIFICATION] Would send notification to ${admin.email} about new audit for ${school.displayName} in module ${module}. Audit ID: ${auditId}`);
    }
  }

  async listMyAudits(user: JwtUser, query: AcademicAuditQueryInput) {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const where = await this.buildAuditWhereForUser(user, query);

    const [total, audits] = await Promise.all([
      prisma.academicAudit.count({ where }),
      prisma.academicAudit.findMany({
        where,
        include: {
          school: {
            select: {
              id: true,
              displayName: true,
              province: true,
              district: true,
              sector: true,
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
    ]);

    return {
      items: audits.map((a) => ({
        id: a.id,
        school: a.school,
        module: a.module,
        score: a.score,
        status: a.status,
        comment: a.comment,
        recommendation: a.recommendation,
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

  async getAuditById(user: JwtUser, auditId: string) {
    const canView = await this.canAccessAudit(user, auditId);
    if (!canView) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
    }

    const audit = await prisma.academicAudit.findUnique({
      where: { id: auditId },
      include: {
        school: {
          select: {
            id: true,
            displayName: true,
            province: true,
            district: true,
            sector: true,
            email: true,
            phone: true,
          },
        },
        auditor: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        reviewedBy: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
          },
        },
        attachments: { include: { fileAsset: true } },
      },
    });

    if (!audit) {
      throw new AppError(404, 'AUDIT_NOT_FOUND', 'Audit not found');
    }

    return this.mapAuditAttachments(audit);
  }

  async getAuditorDashboard(user: JwtUser) {
    const scope = await this.getAuditorScope(user);
    const schoolIdList = await this.getSchoolIdsInScope(scope);
    const totalSchoolsInScope = schoolIdList.length;

    const submittedStatuses: Prisma.AcademicAuditWhereInput['status'] = {
      in: ['SUBMITTED', 'UNDER_REVIEW', 'APPROVED', 'REJECTED', 'NEEDS_REVISION'],
    };

    const [draftAudits, completedAudits, pendingReview, scoreAgg, submittedReports, schoolsWithAudits] =
      await Promise.all([
        prisma.academicAudit.count({
          where: { auditorId: user.sub, schoolId: { in: schoolIdList }, status: 'DRAFT' },
        }),
        prisma.academicAudit.count({
          where: { auditorId: user.sub, schoolId: { in: schoolIdList }, status: submittedStatuses },
        }),
        prisma.academicAudit.count({
          where: {
            schoolId: { in: schoolIdList },
            status: { in: ['SUBMITTED', 'UNDER_REVIEW'] },
          },
        }),
        prisma.academicAudit.aggregate({
          where: { auditorId: user.sub, schoolId: { in: schoolIdList }, status: submittedStatuses },
          _avg: { score: true },
        }),
        prisma.academicAudit.findMany({
          where: {
            auditorId: user.sub,
            schoolId: { in: schoolIdList },
            status: submittedStatuses,
          },
          include: {
            school: {
              select: {
                displayName: true,
              },
            },
          },
          orderBy: { createdAt: 'desc' },
          take: 5,
        }),
        prisma.academicAudit.findMany({
          where: {
            auditorId: user.sub,
            schoolId: { in: schoolIdList },
            status: submittedStatuses,
          },
          select: { schoolId: true },
          distinct: ['schoolId'],
        }),
      ]);

    const auditedSchoolIds = new Set(schoolsWithAudits.map(a => a.schoolId));
    const pendingSchools = totalSchoolsInScope - auditedSchoolIds.size;

    return {
      scope,
      stats: {
        totalSchoolsInScope,
        completedAudits,
        draftAudits,
        pendingSchools,
        pendingReview,
        averageComplianceScore: scoreAgg._avg.score !== null ? Math.round(scoreAgg._avg.score) : null,
      },
      recentAudits: submittedReports.map((a) => ({
        id: a.id,
        school: a.school.displayName,
        module: a.module,
        score: a.score,
        status: a.status,
        createdAt: a.createdAt.toISOString(),
      })),
    };
  }
}

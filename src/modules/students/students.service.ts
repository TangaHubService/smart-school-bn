import { Prisma, StudentGender, UserStatus } from '@prisma/client';
import bcrypt from 'bcrypt';

import { env } from '../../config/env';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { buildPagination } from '../../common/utils/pagination';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import {
  CreateStudentInput,
  ListStudentsQueryInput,
  StudentImportInput,
  UpdateStudentInput,
} from './students.schemas';

interface CsvValidationRow {
  rowNumber: number;
  source: Record<string, string>;
  studentCode: string;
  firstName: string;
  lastName: string;
  gender: StudentGender | null;
  dateOfBirth: string | null;
  academicYearId: string | null;
  classRoomId: string | null;
  enrolledAt: string | null;
  errors: string[];
}

const CSV_HEADER_ALIASES = {
  studentCode: ['studentcode', 'student_code', 'code'],
  firstName: ['firstname', 'first_name', 'givenname', 'given_name'],
  lastName: ['lastname', 'last_name', 'surname'],
  gender: ['gender', 'sex'],
  dateOfBirth: ['dateofbirth', 'date_of_birth', 'dob'],
  academicYearId: ['academicyearid', 'academic_year_id'],
  academicYearName: ['academicyear', 'academic_year', 'academic_year_name'],
  classRoomId: ['classroomid', 'class_room_id', 'classid', 'class_id'],
  classCode: ['classcode', 'class_code'],
  enrolledAt: ['enrolledat', 'enrolled_at', 'enrollmentdate', 'enrollment_date'],
} as const;

export class StudentsService {
  private readonly auditService = new AuditService();

  async createStudent(
    tenantId: string,
    input: CreateStudentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    await this.ensureEnrollmentReferences(
      tenantId,
      input.enrollment.academicYearId,
      input.enrollment.classRoomId,
    );

    try {
      const created = await prisma.$transaction(async (tx) => {
        // 1. Handle User account creation if email is provided
        let userId: string | null = null;
        if (input.email) {
          const normalizedEmail = input.email.toLowerCase().trim();
          const studentCode = input.studentCode.trim().toUpperCase();

          // Upsert User
          const passwordHash = await bcrypt.hash(studentCode, env.BCRYPT_ROUNDS);
          const user = await tx.user.upsert({
            where: {
              tenantId_email: {
                tenantId,
                email: normalizedEmail,
              },
            },
            update: {
              firstName: input.firstName,
              lastName: input.lastName,
              username: studentCode,
            },
            create: {
              tenantId,
              email: normalizedEmail,
              username: studentCode,
              firstName: input.firstName,
              lastName: input.lastName,
              passwordHash,
              status: UserStatus.ACTIVE,
            },
          });
          userId = user.id;

          // Ensure STUDENT role
          const studentRole = await tx.role.findFirst({
            where: {
              tenantId,
              name: 'STUDENT',
            },
          });

          if (studentRole) {
            await tx.userRole.upsert({
              where: {
                tenantId_userId_roleId: {
                  tenantId,
                  userId: user.id,
                  roleId: studentRole.id,
                },
              },
              update: {},
              create: {
                tenantId,
                userId: user.id,
                roleId: studentRole.id,
              },
            });
          }
        }

        const student = await tx.student.create({
          data: {
            tenantId,
            userId,
            studentCode: input.studentCode,
            email: input.email || null,
            firstName: input.firstName,
            lastName: input.lastName,
            gender: input.gender,
            dateOfBirth: input.dateOfBirth ? new Date(input.dateOfBirth) : null,
          },
        });

        const enrollment = await tx.studentEnrollment.create({
          data: {
            tenantId,
            studentId: student.id,
            academicYearId: input.enrollment.academicYearId,
            classRoomId: input.enrollment.classRoomId,
            enrolledAt: input.enrollment.enrolledAt
              ? new Date(input.enrollment.enrolledAt)
              : new Date(),
            isActive: true,
          },
          include: {
            academicYear: true,
            classRoom: true,
          },
        });

        return { student, enrollment };
      });

      await Promise.all([
        this.auditService.log({
          tenantId,
          actorUserId: actor.sub,
          event: AUDIT_EVENT.STUDENT_CREATED,
          entity: 'Student',
          entityId: created.student.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          payload: {
            studentCode: created.student.studentCode,
          },
        }),
        this.auditService.log({
          tenantId,
          actorUserId: actor.sub,
          event: AUDIT_EVENT.STUDENT_ENROLLMENT_CHANGED,
          entity: 'StudentEnrollment',
          entityId: created.enrollment.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          payload: {
            studentId: created.student.id,
            academicYearId: created.enrollment.academicYearId,
            classRoomId: created.enrollment.classRoomId,
            action: 'CREATE',
          },
        }),
      ]);

      return this.getStudentById(tenantId, created.student.id);
    } catch (error) {
      this.handleUniqueError(error, 'Student code already exists');
      throw error;
    }
  }

  async listStudents(tenantId: string, query: ListStudentsQueryInput) {
    const where = this.buildStudentWhere(tenantId, query);
    const skip = (query.page - 1) * query.pageSize;

    const [totalItems, students] = await prisma.$transaction([
      prisma.student.count({ where }),
      prisma.student.findMany({
        where,
        skip,
        take: query.pageSize,
        include: this.studentInclude,
        orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      }),
    ]);

    return {
      items: students.map((student) => this.mapStudent(student)),
      pagination: buildPagination(query.page, query.pageSize, totalItems),
    };
  }

  async updateStudent(
    tenantId: string,
    id: string,
    input: UpdateStudentInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const existing = await prisma.student.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
    });

    if (!existing) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    if (input.enrollment) {
      await this.ensureEnrollmentReferences(
        tenantId,
        input.enrollment.academicYearId,
        input.enrollment.classRoomId,
      );
    }

    try {
      const updated = await prisma.$transaction(async (tx) => {
        // 1. Handle User record updates if email is provided
        let userId: string | null = existing.userId;
        if (input.email) {
          const normalizedEmail = input.email.toLowerCase().trim();
          const studentCode = (input.studentCode || existing.studentCode).trim().toUpperCase();

          const passwordHash = await bcrypt.hash(studentCode, env.BCRYPT_ROUNDS);
          const user = await tx.user.upsert({
            where: {
              tenantId_email: {
                tenantId,
                email: normalizedEmail,
              },
            },
            update: {
              firstName: input.firstName || existing.firstName,
              lastName: input.lastName || existing.lastName,
              username: studentCode,
            },
            create: {
              tenantId,
              email: normalizedEmail,
              username: studentCode,
              firstName: input.firstName || existing.firstName,
              lastName: input.lastName || existing.lastName,
              passwordHash,
              status: UserStatus.ACTIVE,
            },
          });
          userId = user.id;

          const studentRole = await tx.role.findFirst({
            where: {
              tenantId,
              name: 'STUDENT',
            },
          });

          if (studentRole) {
            await tx.userRole.upsert({
              where: {
                tenantId_userId_roleId: {
                  tenantId,
                  userId: user.id,
                  roleId: studentRole.id,
                },
              },
              update: {},
              create: {
                tenantId,
                userId: user.id,
                roleId: studentRole.id,
              },
            });
          }
        }

        await tx.student.update({
          where: { id },
          data: {
            userId,
            studentCode: input.studentCode,
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            gender:
              input.gender === null
                ? null
                : input.gender === undefined
                  ? undefined
                  : input.gender,
            dateOfBirth:
              input.dateOfBirth === null
                ? null
                : input.dateOfBirth
                  ? new Date(input.dateOfBirth)
                  : undefined,
            isActive: input.isActive,
          },
        });

        if (input.enrollment) {
          await tx.studentEnrollment.updateMany({
            where: {
              tenantId,
              studentId: id,
              isActive: true,
            },
            data: {
              isActive: false,
              endedAt: new Date(),
            },
          });

          await tx.studentEnrollment.upsert({
            where: {
              tenantId_studentId_academicYearId: {
                tenantId,
                studentId: id,
                academicYearId: input.enrollment.academicYearId,
              },
            },
            update: {
              classRoomId: input.enrollment.classRoomId,
              isActive: true,
              endedAt: null,
              enrolledAt: input.enrollment.enrolledAt
                ? new Date(input.enrollment.enrolledAt)
                : new Date(),
            },
            create: {
              tenantId,
              studentId: id,
              academicYearId: input.enrollment.academicYearId,
              classRoomId: input.enrollment.classRoomId,
              enrolledAt: input.enrollment.enrolledAt
                ? new Date(input.enrollment.enrolledAt)
                : new Date(),
              isActive: true,
            },
          });
        }

        return tx.student.findFirst({
          where: {
            id,
            tenantId,
            deletedAt: null,
          },
          include: this.studentInclude,
        });
      });

      if (!updated) {
        throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
      }

      await this.auditService.log({
        tenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.STUDENT_UPDATED,
        entity: 'Student',
        entityId: updated.id,
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          enrollmentChanged: Boolean(input.enrollment),
        },
      });

      if (input.enrollment) {
        await this.auditService.log({
          tenantId,
          actorUserId: actor.sub,
          event: AUDIT_EVENT.STUDENT_ENROLLMENT_CHANGED,
          entity: 'Student',
          entityId: updated.id,
          requestId: context.requestId,
          ipAddress: context.ipAddress,
          userAgent: context.userAgent,
          payload: {
            academicYearId: input.enrollment.academicYearId,
            classRoomId: input.enrollment.classRoomId,
            action: 'UPDATE',
          },
        });
      }

      return this.mapStudent(updated);
    } catch (error) {
      this.handleUniqueError(error, 'Student code already exists');
      throw error;
    }
  }

  async deleteStudent(
    tenantId: string,
    id: string,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const result = await prisma.$transaction(async (tx) => {
      const updated = await tx.student.updateMany({
        where: {
          id,
          tenantId,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
          isActive: false,
        },
      });

      if (!updated.count) {
        return { deleted: false };
      }

      await tx.studentEnrollment.updateMany({
        where: {
          tenantId,
          studentId: id,
          isActive: true,
        },
        data: {
          isActive: false,
          endedAt: new Date(),
        },
      });

      await tx.parentStudent.updateMany({
        where: {
          tenantId,
          studentId: id,
          deletedAt: null,
        },
        data: {
          deletedAt: new Date(),
        },
      });

      return { deleted: true };
    });

    if (!result.deleted) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.STUDENT_DELETED,
      entity: 'Student',
      entityId: id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
    });

    return { deleted: true };
  }

  async importStudents(
    tenantId: string,
    input: StudentImportInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    const effectiveTenantId = await this.resolveImportTenantId(tenantId, input.targetTenantId, actor);
    const parsedRows = this.parseCsvContent(input.csv);

    if (!parsedRows.length) {
      throw new AppError(400, 'CSV_EMPTY', 'CSV file has no rows');
    }

    const headerRow = parsedRows[0];
    const rows = parsedRows.slice(1).filter((row) => row.some((value) => value.trim().length));

    if (!rows.length) {
      throw new AppError(400, 'CSV_EMPTY', 'CSV file has no data rows');
    }

    const normalizedHeaders = headerRow.map((header) => this.normalizeHeader(header));

    const academicYears = await prisma.academicYear.findMany({
      where: {
        tenantId: effectiveTenantId,
        isActive: true,
      },
      select: {
        id: true,
        name: true,
      },
    });

    const classRooms = await prisma.classRoom.findMany({
      where: {
        tenantId: effectiveTenantId,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        name: true,
      },
    });

    const yearById = new Map(academicYears.map((item) => [item.id, item]));
    const yearByName = new Map(academicYears.map((item) => [item.name.toLowerCase(), item]));

    const classById = new Map(classRooms.map((item) => [item.id, item]));
    const classByCode = new Map(classRooms.map((item) => [item.code.toLowerCase(), item]));

    const seenCodes = new Set<string>();
    const previewRows: CsvValidationRow[] = rows.map((row, index) => {
      const rowNumber = index + 2;
      const source = this.toSourceRow(normalizedHeaders, row);
      const errors: string[] = [];

      const studentCode = this.readCsvField(source, CSV_HEADER_ALIASES.studentCode);
      const firstName = this.readCsvField(source, CSV_HEADER_ALIASES.firstName);
      const lastName = this.readCsvField(source, CSV_HEADER_ALIASES.lastName);

      if (!studentCode) {
        errors.push('studentCode is required');
      }
      if (!firstName) {
        errors.push('firstName is required');
      }
      if (!lastName) {
        errors.push('lastName is required');
      }

      if (studentCode) {
        const codeKey = studentCode.toLowerCase();
        if (seenCodes.has(codeKey)) {
          errors.push('Duplicate studentCode in CSV');
        } else {
          seenCodes.add(codeKey);
        }
      }

      const genderRaw = this.readCsvField(source, CSV_HEADER_ALIASES.gender);
      let gender: StudentGender | null = null;
      if (genderRaw) {
        const parsedGender = this.parseGender(genderRaw);
        if (!parsedGender) {
          errors.push('gender must be MALE, FEMALE, OTHER, or UNDISCLOSED');
        } else {
          gender = parsedGender;
        }
      }

      const dateOfBirthRaw = this.readCsvField(source, CSV_HEADER_ALIASES.dateOfBirth);
      let dateOfBirth: string | null = null;
      if (dateOfBirthRaw) {
        const parsed = this.parseDateString(dateOfBirthRaw);
        if (!parsed) {
          errors.push('dateOfBirth must be YYYY-MM-DD or ISO date');
        } else {
          dateOfBirth = parsed;
        }
      }

      const yearIdRaw =
        this.readCsvField(source, CSV_HEADER_ALIASES.academicYearId) ||
        input.defaultAcademicYearId ||
        null;
      const yearNameRaw = this.readCsvField(source, CSV_HEADER_ALIASES.academicYearName) || null;

      let academicYearId: string | null = null;
      if (yearIdRaw && yearById.has(yearIdRaw)) {
        academicYearId = yearIdRaw;
      } else if (yearNameRaw) {
        academicYearId = yearByName.get(yearNameRaw.toLowerCase())?.id ?? null;
      }

      if (!academicYearId) {
        errors.push('academicYearId (or academicYear name) is required and must exist');
      }

      const classIdRaw =
        this.readCsvField(source, CSV_HEADER_ALIASES.classRoomId) ||
        input.defaultClassRoomId ||
        null;
      const classCodeRaw = this.readCsvField(source, CSV_HEADER_ALIASES.classCode) || null;

      let classRoomId: string | null = null;
      if (classIdRaw && classById.has(classIdRaw)) {
        classRoomId = classIdRaw;
      } else if (classCodeRaw) {
        classRoomId = classByCode.get(classCodeRaw.toLowerCase())?.id ?? null;
      }

      if (!classRoomId) {
        errors.push('classRoomId (or classCode) is required and must exist');
      }

      const enrolledAtRaw = this.readCsvField(source, CSV_HEADER_ALIASES.enrolledAt);
      let enrolledAt: string | null = null;
      if (enrolledAtRaw) {
        const parsed = this.parseDateString(enrolledAtRaw);
        if (!parsed) {
          errors.push('enrolledAt must be YYYY-MM-DD or ISO date');
        } else {
          enrolledAt = parsed;
        }
      }

      return {
        rowNumber,
        source,
        studentCode,
        firstName,
        lastName,
        gender,
        dateOfBirth,
        academicYearId,
        classRoomId,
        enrolledAt,
        errors,
      };
    });

    const candidateCodes = previewRows
      .map((row) => row.studentCode)
      .filter((studentCode) => studentCode.length > 0);

    if (candidateCodes.length) {
      const existing = await prisma.student.findMany({
        where: {
          tenantId: effectiveTenantId,
          studentCode: {
            in: candidateCodes,
          },
          deletedAt: null,
        },
        select: {
          studentCode: true,
        },
      });

      const existingCodes = new Set(existing.map((item) => item.studentCode.toLowerCase()));
      for (const row of previewRows) {
        if (row.studentCode && existingCodes.has(row.studentCode.toLowerCase())) {
          row.errors.push('studentCode already exists');
        }
      }
    }

    const validRows = previewRows.filter((row) => row.errors.length === 0);
    const invalidRows = previewRows.length - validRows.length;

    const summary = {
      totalRows: previewRows.length,
      validRows: validRows.length,
      invalidRows,
    };

    if (input.mode === 'preview') {
      return {
        mode: 'preview',
        targetTenantId: effectiveTenantId,
        summary,
        rows: previewRows,
      };
    }

    if (invalidRows > 0 && !input.allowPartial) {
      throw new AppError(
        400,
        'IMPORT_VALIDATION_FAILED',
        'CSV has validation errors. Fix rows and retry commit, or use allowPartial=true.',
        {
          summary,
          rows: previewRows.filter((row) => row.errors.length).slice(0, 100),
        },
      );
    }

    if (!validRows.length) {
      return {
        mode: 'commit',
        targetTenantId: effectiveTenantId,
        summary: {
          ...summary,
          importedRows: 0,
          skippedRows: previewRows.length,
        },
        rows: previewRows,
      };
    }

    try {
      const importedStudentCodes = validRows.map((row) => row.studentCode);

      await prisma.$transaction(async (tx) => {
        await tx.student.createMany({
          data: validRows.map((row) => ({
            tenantId: effectiveTenantId,
            studentCode: row.studentCode,
            firstName: row.firstName,
            lastName: row.lastName,
            gender: row.gender,
            dateOfBirth: row.dateOfBirth ? new Date(row.dateOfBirth) : null,
          })),
        });

        const insertedStudents = await tx.student.findMany({
          where: {
            tenantId: effectiveTenantId,
            studentCode: {
              in: importedStudentCodes,
            },
            deletedAt: null,
          },
          select: {
            id: true,
            studentCode: true,
          },
        });

        const studentIdByCode = new Map(
          insertedStudents.map((student) => [student.studentCode, student.id]),
        );

        await tx.studentEnrollment.createMany({
          data: validRows.map((row) => {
            const studentId = studentIdByCode.get(row.studentCode);
            if (!studentId || !row.academicYearId || !row.classRoomId) {
              throw new AppError(
                500,
                'IMPORT_STUDENT_MAPPING_FAILED',
                `Failed to map imported student code ${row.studentCode}`,
              );
            }

            return {
              tenantId: effectiveTenantId,
              studentId,
              academicYearId: row.academicYearId,
              classRoomId: row.classRoomId,
              enrolledAt: row.enrolledAt ? new Date(row.enrolledAt) : new Date(),
              isActive: true,
            };
          }),
        });
      });

      await this.auditService.log({
        tenantId: effectiveTenantId,
        actorUserId: actor.sub,
        event: AUDIT_EVENT.STUDENT_IMPORT_COMMITTED,
        entity: 'Student',
        requestId: context.requestId,
        ipAddress: context.ipAddress,
        userAgent: context.userAgent,
        payload: {
          importedRows: validRows.length,
          skippedRows: invalidRows,
          sourceTenantId: tenantId,
        },
      });

      return {
        mode: 'commit',
        targetTenantId: effectiveTenantId,
        summary: {
          ...summary,
          importedRows: validRows.length,
          skippedRows: invalidRows,
        },
        rows: previewRows,
      };
    } catch (error) {
      this.handleUniqueError(error, 'Import failed because some student codes already exist');
      throw error;
    }
  }

  private async resolveImportTenantId(
    tenantId: string,
    targetTenantId: string | undefined,
    actor: JwtUser,
  ) {
    if (!targetTenantId || targetTenantId === tenantId) {
      return tenantId;
    }

    if (!actor.roles.includes('SUPER_ADMIN')) {
      throw new AppError(
        403,
        'STUDENT_IMPORT_TENANT_FORBIDDEN',
        'You cannot import students into another school',
      );
    }

    const tenant = await prisma.tenant.findFirst({
      where: {
        id: targetTenantId,
        isActive: true,
      },
      select: {
        id: true,
      },
    });

    if (!tenant) {
      throw new AppError(404, 'TENANT_NOT_FOUND', 'Selected school was not found');
    }

    return tenant.id;
  }

  async exportStudents(tenantId: string, query: ListStudentsQueryInput) {
    const where = this.buildStudentWhere(tenantId, query);

    const students = await prisma.student.findMany({
      where,
      include: this.studentInclude,
      orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }],
      take: 5000,
    });

    const header = [
      'studentCode',
      'firstName',
      'lastName',
      'gender',
      'dateOfBirth',
      'academicYear',
      'classCode',
      'className',
      'parents',
    ];

    const lines = students.map((student) => {
      const activeEnrollment = student.enrollments[0] ?? null;
      const parentNames = student.parentLinks
        .map((item) => `${item.parent.firstName} ${item.parent.lastName}`)
        .join('; ');

      return [
        student.studentCode,
        student.firstName,
        student.lastName,
        student.gender ?? '',
        student.dateOfBirth ? student.dateOfBirth.toISOString().slice(0, 10) : '',
        activeEnrollment?.academicYear.name ?? '',
        activeEnrollment?.classRoom.code ?? '',
        activeEnrollment?.classRoom.name ?? '',
        parentNames,
      ]
        .map((value) => this.escapeCsvValue(value))
        .join(',');
    });

    const csv = [header.join(','), ...lines].join('\n');
    const fileName = `students-${new Date().toISOString().slice(0, 10)}.csv`;

    return {
      fileName,
      rowCount: students.length,
      csv,
    };
  }

  private readonly studentInclude = {
    enrollments: {
      where: { isActive: true },
      include: {
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
      orderBy: {
        updatedAt: 'desc' as const,
      },
      take: 1,
    },
    parentLinks: {
      where: { deletedAt: null },
      include: {
        parent: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            email: true,
            phone: true,
          },
        },
      },
      orderBy: {
        createdAt: 'desc' as const,
      },
    },
  };

  async getStudentDetail(tenantId: string, id: string) {
    return this.getStudentById(tenantId, id);
  }

  private async getStudentById(tenantId: string, id: string) {
    const student = await prisma.student.findFirst({
      where: {
        id,
        tenantId,
        deletedAt: null,
      },
      include: this.studentInclude,
    });

    if (!student) {
      throw new AppError(404, 'STUDENT_NOT_FOUND', 'Student not found');
    }

    return this.mapStudent(student);
  }

  private mapStudent(student: {
    id: string;
    studentCode: string;
    firstName: string;
    lastName: string;
    gender: StudentGender | null;
    dateOfBirth: Date | null;
    isActive: boolean;
    createdAt: Date;
    updatedAt: Date;
    enrollments: Array<{
      id: string;
      academicYearId: string;
      classRoomId: string;
      enrolledAt: Date;
      academicYear: { id: string; name: string };
      classRoom: { id: string; code: string; name: string };
    }>;
    parentLinks: Array<{
      id: string;
      relationship: string;
      isPrimary: boolean;
      parent: {
        id: string;
        firstName: string;
        lastName: string;
        email: string | null;
        phone: string | null;
      };
    }>;
  }) {
    const activeEnrollment = student.enrollments[0] ?? null;

    return {
      id: student.id,
      studentCode: student.studentCode,
      firstName: student.firstName,
      lastName: student.lastName,
      gender: student.gender,
      dateOfBirth: student.dateOfBirth,
      isActive: student.isActive,
      createdAt: student.createdAt,
      updatedAt: student.updatedAt,
      currentEnrollment: activeEnrollment
        ? {
            id: activeEnrollment.id,
            academicYear: activeEnrollment.academicYear,
            classRoom: activeEnrollment.classRoom,
            enrolledAt: activeEnrollment.enrolledAt,
          }
        : null,
      parents: student.parentLinks.map((link) => ({
        id: link.parent.id,
        firstName: link.parent.firstName,
        lastName: link.parent.lastName,
        email: link.parent.email,
        phone: link.parent.phone,
        relationship: link.relationship,
        isPrimary: link.isPrimary,
      })),
    };
  }

  private buildStudentWhere(
    tenantId: string,
    query: Pick<ListStudentsQueryInput, 'classId' | 'academicYearId' | 'q'>,
  ): Prisma.StudentWhereInput {
    const where: Prisma.StudentWhereInput = {
      tenantId,
      deletedAt: null,
    };

    if (query.q) {
      where.OR = [
        {
          studentCode: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          firstName: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
        {
          lastName: {
            contains: query.q,
            mode: 'insensitive',
          },
        },
      ];
    }

    if (query.classId || query.academicYearId) {
      where.enrollments = {
        some: {
          isActive: true,
          classRoomId: query.classId,
          academicYearId: query.academicYearId,
        },
      };
    }

    return where;
  }

  private async ensureEnrollmentReferences(
    tenantId: string,
    academicYearId: string,
    classRoomId: string,
  ) {
    const [year, classRoom] = await prisma.$transaction([
      prisma.academicYear.findFirst({
        where: {
          id: academicYearId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      }),
      prisma.classRoom.findFirst({
        where: {
          id: classRoomId,
          tenantId,
          isActive: true,
        },
        select: {
          id: true,
          name: true,
        },
      }),
    ]);

    if (!year) {
      throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');
    }

    if (!classRoom) {
      throw new AppError(404, 'CLASS_ROOM_NOT_FOUND', 'Class room not found');
    }
  }

  private parseDateString(value: string): string | null {
    const normalized = value.trim();
    if (!normalized) {
      return null;
    }

    const parsed = new Date(normalized);
    if (Number.isNaN(parsed.getTime())) {
      return null;
    }

    return parsed.toISOString();
  }

  private parseGender(value: string): StudentGender | null {
    const normalized = value.trim().toUpperCase();
    if (!normalized) {
      return null;
    }

    if (normalized in StudentGender) {
      return normalized as StudentGender;
    }

    return null;
  }

  private parseCsvContent(content: string): string[][] {
    const rows: string[][] = [];
    let row: string[] = [];
    let cell = '';
    let inQuotes = false;

    const normalized = content.replace(/^\uFEFF/, '');

    for (let index = 0; index < normalized.length; index += 1) {
      const char = normalized[index];
      const nextChar = normalized[index + 1];

      if (char === '"') {
        if (inQuotes && nextChar === '"') {
          cell += '"';
          index += 1;
        } else {
          inQuotes = !inQuotes;
        }
        continue;
      }

      if (char === ',' && !inQuotes) {
        row.push(cell.trim());
        cell = '';
        continue;
      }

      if ((char === '\n' || char === '\r') && !inQuotes) {
        if (char === '\r' && nextChar === '\n') {
          index += 1;
        }

        row.push(cell.trim());
        if (row.some((value) => value.length > 0)) {
          rows.push(row);
        }
        row = [];
        cell = '';
        continue;
      }

      cell += char;
    }

    if (cell.length > 0 || row.length > 0) {
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) {
        rows.push(row);
      }
    }

    return rows;
  }

  private normalizeHeader(header: string): string {
    return header.trim().toLowerCase().replace(/[^a-z0-9]+/g, '');
  }

  private toSourceRow(headers: string[], row: string[]): Record<string, string> {
    const source: Record<string, string> = {};
    for (let index = 0; index < headers.length; index += 1) {
      const header = headers[index];
      if (!header) {
        continue;
      }
      source[header] = (row[index] ?? '').trim();
    }

    return source;
  }

  private readCsvField(source: Record<string, string>, aliases: readonly string[]): string {
    for (const alias of aliases) {
      const value = source[alias];
      if (value) {
        return value.trim();
      }
    }

    return '';
  }

  private escapeCsvValue(value: string): string {
    if (!value.includes(',') && !value.includes('"') && !value.includes('\n')) {
      return value;
    }

    return `"${value.replace(/"/g, '""')}"`;
  }

  private handleUniqueError(error: unknown, message: string): never | void {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new AppError(409, 'UNIQUE_CONSTRAINT_VIOLATION', message, error.meta);
    }
  }
}

import { Prisma } from '@prisma/client';

import { AppError } from '../../common/errors/app-error';
import { JwtUser, RequestAuditContext } from '../../common/types/auth.types';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { prisma } from '../../db/prisma';
import { AuditService } from '../audit/audit.service';
import { SchoolSetupInput } from './schools.schemas';

export class SchoolsService {
  private readonly auditService = new AuditService();

  async completeSetup(
    tenantId: string,
    input: SchoolSetupInput,
    actor: JwtUser,
    context: RequestAuditContext,
  ) {
    this.validateChronology(input);

    const result = await prisma.$transaction(async (tx) => {
      const school = await tx.school.upsert({
        where: { tenantId },
        update: {
          displayName: input.school?.displayName,
          registrationNumber: input.school?.registrationNumber,
          email: input.school?.email,
          phone: input.school?.phone,
          addressLine1: input.school?.addressLine1,
          addressLine2: input.school?.addressLine2,
          province: input.school?.province,
          city: input.school?.city,
          district: input.school?.district,
          sector: input.school?.sector,
          cell: input.school?.cell,
          village: input.school?.village,
          country: input.school?.country,
          timezone: input.school?.timezone,
          setupCompletedAt: input.markSetupComplete ? new Date() : undefined,
        },
        create: {
          tenantId,
          displayName: input.school?.displayName ?? 'School',
          registrationNumber: input.school?.registrationNumber,
          email: input.school?.email,
          phone: input.school?.phone,
          addressLine1: input.school?.addressLine1,
          addressLine2: input.school?.addressLine2,
          province: input.school?.province,
          city: input.school?.city,
          district: input.school?.district,
          sector: input.school?.sector,
          cell: input.school?.cell,
          village: input.school?.village,
          country: input.school?.country ?? 'Rwanda',
          timezone: input.school?.timezone ?? 'Africa/Kigali',
          setupCompletedAt: input.markSetupComplete ? new Date() : null,
        },
      });

      let academicYearId: string | null = null;
      let createdTerms = 0;

      if (input.academicYear) {
        if (input.academicYear.isCurrent) {
          await tx.academicYear.updateMany({
            where: { tenantId, isCurrent: true },
            data: { isCurrent: false },
          });
        }

        const academicYear = await tx.academicYear.upsert({
          where: {
            tenantId_name: {
              tenantId,
              name: input.academicYear.name,
            },
          },
          update: {
            startDate: new Date(input.academicYear.startDate),
            endDate: new Date(input.academicYear.endDate),
            isCurrent: input.academicYear.isCurrent,
            isActive: true,
          },
          create: {
            tenantId,
            name: input.academicYear.name,
            startDate: new Date(input.academicYear.startDate),
            endDate: new Date(input.academicYear.endDate),
            isCurrent: input.academicYear.isCurrent,
            isActive: true,
          },
        });

        academicYearId = academicYear.id;

        for (const termInput of input.academicYear.terms) {
          await tx.term.upsert({
            where: {
              tenantId_academicYearId_name: {
                tenantId,
                academicYearId: academicYear.id,
                name: termInput.name,
              },
            },
            update: {
              sequence: termInput.sequence,
              startDate: new Date(termInput.startDate),
              endDate: new Date(termInput.endDate),
              isActive: true,
            },
            create: {
              tenantId,
              academicYearId: academicYear.id,
              name: termInput.name,
              sequence: termInput.sequence,
              startDate: new Date(termInput.startDate),
              endDate: new Date(termInput.endDate),
              isActive: true,
            },
          });
          createdTerms += 1;
        }
      }

      let createdGradeLevels = 0;
      let createdClassRooms = 0;
      for (const level of input.gradeLevels) {
        const gradeLevel = await tx.gradeLevel.upsert({
          where: {
            tenantId_code: {
              tenantId,
              code: level.code,
            },
          },
          update: {
            name: level.name,
            rank: level.rank,
            isActive: true,
          },
          create: {
            tenantId,
            code: level.code,
            name: level.name,
            rank: level.rank,
            isActive: true,
          },
        });
        createdGradeLevels += 1;

        for (const classInput of level.classes) {
          await tx.classRoom.upsert({
            where: {
              tenantId_code: {
                tenantId,
                code: classInput.code,
              },
            },
            update: {
              gradeLevelId: gradeLevel.id,
              name: classInput.name,
              capacity: classInput.capacity,
              isActive: true,
            },
            create: {
              tenantId,
              gradeLevelId: gradeLevel.id,
              code: classInput.code,
              name: classInput.name,
              capacity: classInput.capacity,
              isActive: true,
            },
          });
          createdClassRooms += 1;
        }
      }

      let createdSubjects = 0;
      for (const subjectInput of input.subjects) {
        await tx.subject.upsert({
          where: {
            tenantId_code: {
              tenantId,
              code: subjectInput.code,
            },
          },
          update: {
            name: subjectInput.name,
            description: subjectInput.description,
            isCore: subjectInput.isCore,
            isActive: true,
          },
          create: {
            tenantId,
            code: subjectInput.code,
            name: subjectInput.name,
            description: subjectInput.description,
            isCore: subjectInput.isCore,
            isActive: true,
          },
        });

        createdSubjects += 1;
      }

      return {
        school,
        academicYearId,
        createdTerms,
        createdGradeLevels,
        createdClassRooms,
        createdSubjects,
      };
    });

    await this.auditService.log({
      tenantId,
      actorUserId: actor.sub,
      event: AUDIT_EVENT.SCHOOL_SETUP_UPDATED,
      entity: 'School',
      entityId: result.school.id,
      requestId: context.requestId,
      ipAddress: context.ipAddress,
      userAgent: context.userAgent,
      payload: {
        academicYearId: result.academicYearId,
        createdTerms: result.createdTerms,
        createdGradeLevels: result.createdGradeLevels,
        createdClassRooms: result.createdClassRooms,
        createdSubjects: result.createdSubjects,
      },
    });

    return {
      school: {
        id: result.school.id,
        tenantId,
        displayName: result.school.displayName,
        setupCompletedAt: result.school.setupCompletedAt,
      },
      summary: {
        academicYearId: result.academicYearId,
        createdTerms: result.createdTerms,
        createdGradeLevels: result.createdGradeLevels,
        createdClassRooms: result.createdClassRooms,
        createdSubjects: result.createdSubjects,
      },
    };
  }

  async getSchoolSetupStatus(tenantId: string) {
    const school = await prisma.school.findUnique({
      where: { tenantId },
    });

    return {
      isSetupComplete: Boolean(school?.setupCompletedAt),
      school,
    };
  }

  private validateChronology(input: SchoolSetupInput) {
    if (input.academicYear) {
      const start = new Date(input.academicYear.startDate);
      const end = new Date(input.academicYear.endDate);

      if (!(start < end)) {
        throw new AppError(
          400,
          'SCHOOL_SETUP_INVALID_ACADEMIC_YEAR_DATES',
          'Academic year startDate must be earlier than endDate',
        );
      }

      for (const term of input.academicYear.terms) {
        const termStart = new Date(term.startDate);
        const termEnd = new Date(term.endDate);

        if (!(termStart < termEnd)) {
          throw new AppError(
            400,
            'SCHOOL_SETUP_INVALID_TERM_DATES',
            'Term startDate must be earlier than endDate',
            { term: term.name },
          );
        }

        if (termStart < start || termEnd > end) {
          throw new AppError(
            400,
            'SCHOOL_SETUP_TERM_OUT_OF_RANGE',
            'Term dates must be within the academic year range',
            { term: term.name },
          );
        }
      }
    }
  }
}

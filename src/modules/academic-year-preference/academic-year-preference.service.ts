import { JwtUser } from '../../common/types/auth.types';
import { AppError } from '../../common/errors/app-error';
import { prisma } from '../../db/prisma';
import { SetAcademicYearPreferenceInput } from './academic-year-preference.schemas';

export class AcademicYearPreferenceService {
  async getPreference(tenantId: string, userId: string) {
    const pref = await prisma.userAcademicYearPreference.findUnique({
      where: { userId },
      include: {
        academicYear: { select: { id: true, name: true, isCurrent: true } },
      },
    });
    return pref ? {
      academicYearId: pref.academicYearId,
      termId: pref.termId ?? null,
      academicYear: pref.academicYear,
    } : null;
  }

  async setPreference(tenantId: string, userId: string, input: SetAcademicYearPreferenceInput) {
    const year = await prisma.academicYear.findFirst({
      where: { id: input.academicYearId, tenantId, isActive: true },
      select: { id: true },
    });
    if (!year) throw new AppError(404, 'ACADEMIC_YEAR_NOT_FOUND', 'Academic year not found');

    if (input.termId) {
      const term = await prisma.term.findFirst({
        where: { id: input.termId, tenantId, academicYearId: input.academicYearId },
        select: { id: true },
      });
      if (!term) throw new AppError(404, 'TERM_NOT_FOUND', 'Term not found');
    }

    const pref = await prisma.userAcademicYearPreference.upsert({
      where: { userId },
      create: { userId, tenantId, academicYearId: input.academicYearId, termId: input.termId ?? null },
      update: { academicYearId: input.academicYearId, termId: input.termId ?? null },
    });

    return { academicYearId: pref.academicYearId, termId: pref.termId };
  }

  async listAcademicYears(tenantId: string, isActive?: boolean) {
    const where: any = { tenantId };
    if (isActive !== undefined) where.isActive = isActive;
    return prisma.academicYear.findMany({
      where,
      include: {
        terms: { where: { isActive: true }, select: { id: true, name: true, sequence: true }, orderBy: { sequence: 'asc' } },
      },
      orderBy: { startDate: 'desc' },
    });
  }
}

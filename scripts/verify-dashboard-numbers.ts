/* Compares dashboard figures with direct database counts. Read-only. */
import { prisma } from '../src/db/prisma';
import { DashboardService } from '../src/modules/dashboard/dashboard.service';

type Row = { metric: string; dashboard: unknown; database: unknown };
const rows: Row[] = [];
const check = (metric: string, dashboard: unknown, database: unknown) =>
  rows.push({ metric, dashboard, database });

async function main() {
  const svc = new DashboardService();
  const actor = (tenantId: string, sub = 'verify') =>
    ({ sub, tenantId, email: '', roles: [], permissions: [] }) as never;

  // ---------- Super admin ----------
  const sa = await svc.getSuperAdminDashboard(actor('platform'));
  const m = sa.metrics as Record<string, number>;
  check('SA activeSchools', m.activeSchools, await prisma.tenant.count({
    where: { code: { not: 'platform' }, school: { setupCompletedAt: { not: null } } },
  }));
  check('SA totalUsers', m.totalUsers, '(see note)');
  const payments = await prisma.academySubscriptionPayment.findMany({
    where: { status: 'COMPLETED' }, select: { amount: true },
  });
  check('SA totalRevenue', sa.revenue?.totalRevenue, payments.reduce((s, p) => s + p.amount, 0));
  check('SA revenueThisMonth', sa.revenue?.revenueThisMonth, '(month sum)');

  // ---------- School admin (every school tenant) ----------
  const tenants = await prisma.tenant.findMany({
    where: { code: { not: 'platform' } }, select: { id: true, code: true },
  });
  for (const t of tenants) {
    let d;
    try {
      d = await svc.getSchoolAdminDashboard(actor(t.id));
    } catch (e) {
      check(`[${t.code}] school-admin`, 'ERROR', (e as Error).message);
      continue;
    }
    const year =
      (await prisma.academicYear.findFirst({
        where: { tenantId: t.id, isCurrent: true, isActive: true },
        orderBy: { startDate: 'desc' }, select: { id: true },
      })) ??
      (await prisma.academicYear.findFirst({
        where: { tenantId: t.id, isActive: true },
        orderBy: { startDate: 'desc' }, select: { id: true },
      }));
    const ay = year?.id ? { academicYearId: year.id } : {};
    check(`[${t.code}] totalStudents (active enrollments, current year)`,
      d.metrics.totalStudents,
      await prisma.studentEnrollment.count({ where: { tenantId: t.id, isActive: true, ...ay } }));
    check(`[${t.code}]   students in Students list (not deleted)`,
      '—', await prisma.student.count({ where: { tenantId: t.id, deletedAt: null } }));
    check(`[${t.code}] teachers (distinct course teachers)`, d.metrics.teachers,
      (await prisma.course.findMany({ where: { tenantId: t.id, ...ay }, distinct: ['teacherUserId'], select: { teacherUserId: true } })).length);
    check(`[${t.code}]   users with TEACHER role`, '—',
      await prisma.user.count({ where: { tenantId: t.id, deletedAt: null, userRoles: { some: { role: { name: 'TEACHER' } } } } }));
    check(`[${t.code}] classes`, d.metrics.classes, '(active classes)');
    check(`[${t.code}] examsConducted`, d.metrics.examsConducted,
      await prisma.exam.count({ where: { tenantId: t.id, ...ay, marks: { some: {} } } }));
    if (d.invoice) check(`[${t.code}] invoice amountDue (raw)`, d.invoice.amountDue, 'shown exactly now');

    try {
      const demo = await svc.getDemographics(actor(t.id));
      const boys = await prisma.student.count({ where: { tenantId: t.id, deletedAt: null, gender: 'MALE' } });
      const girls = await prisma.student.count({ where: { tenantId: t.id, deletedAt: null, gender: 'FEMALE' } });
      check(`[${t.code}] demographics total/boys/girls`,
        `${demo.totalStudents}/${demo.totalBoys}/${demo.totalGirls}`, `?/${boys}/${girls} (all non-deleted)`);
    } catch (e) {
      check(`[${t.code}] demographics`, 'ERROR', (e as Error).message);
    }
  }

  console.table(rows);
}

main().finally(() => prisma.$disconnect());

import { prisma } from '../../db/prisma';
import { env } from '../../config/env';

export async function resolveAcademyCatalogTenantId(): Promise<string | null> {
  if (env.ACADEMY_CATALOG_TENANT_ID) {
    const byEnv = await prisma.tenant.findFirst({
      where: { id: env.ACADEMY_CATALOG_TENANT_ID, isActive: true },
      select: { id: true },
    });
    if (byEnv) {
      return byEnv.id;
    }
  }
  const flagged = await prisma.tenant.findFirst({
    where: { isAcademyCatalog: true, isActive: true },
    select: { id: true },
  });
  return flagged?.id ?? null;
}

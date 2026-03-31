import { Prisma } from '@prisma/client';

import { rootLogger } from '../../config/logger';
import { prisma } from '../../db/prisma';

interface AuditLogInput {
  tenantId: string;
  actorUserId?: string | null;
  event: string;
  entity?: string | null;
  entityId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  payload?: unknown;
}

export class AuditService {
  async log(input: AuditLogInput): Promise<void> {
    try {
      await prisma.auditLog.create({
        data: {
          tenantId: input.tenantId,
          actorUserId: input.actorUserId ?? null,
          event: input.event,
          entity: input.entity ?? null,
          entityId: input.entityId ?? null,
          requestId: input.requestId ?? null,
          ipAddress: input.ipAddress ?? null,
          userAgent: input.userAgent ?? null,
          payload:
            input.payload === undefined
              ? undefined
              : input.payload === null
                ? Prisma.JsonNull
                : (input.payload as Prisma.InputJsonValue),
        },
      });
    } catch (error) {
      rootLogger.error(
        {
          err: error,
          event: input.event,
          entity: input.entity,
          entityId: input.entityId,
          tenantId: input.tenantId,
        },
        'Audit log write failed',
      );
    }
  }
}

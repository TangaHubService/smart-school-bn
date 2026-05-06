import { AuditActionType, AuditLogStatus, Prisma } from '@prisma/client';

import { rootLogger } from '../../config/logger';
import { prisma } from '../../db/prisma';
import { getAuditRequestContext } from '../../common/utils/request-audit-context';
import {
  buildActorName,
  buildDeviceLabel,
  buildLegacyAuditEvent,
  extractOldAndNewValues,
  inferAuditActionType,
  inferAuditDescription,
  inferAuditModule,
  inferAuditStatus,
  normalizeAuditValue,
  resolvePrimaryRole,
} from './audit-log.utils';

interface AuditActorInput {
  userId?: string | null;
  fullName?: string | null;
  role?: string | null;
  schoolName?: string | null;
}

interface AuditLogInput {
  tenantId?: string;
  actorUserId?: string | null;
  actorName?: string | null;
  actorRole?: string | null;
  schoolName?: string | null;
  event?: string;
  actionType?: AuditActionType | null;
  module?: string | null;
  description?: string | null;
  entity?: string | null;
  entityId?: string | null;
  recordId?: string | null;
  requestId?: string | null;
  ipAddress?: string | null;
  userAgent?: string | null;
  device?: string | null;
  status?: AuditLogStatus | null;
  sessionId?: string | null;
  oldValue?: unknown;
  newValue?: unknown;
  payload?: unknown;
}

interface LogActivityInput extends Omit<
  AuditLogInput,
  'actorUserId' | 'actorName' | 'actorRole' | 'schoolName'
> {
  actor?: AuditActorInput | null;
}

interface ResolvedAuditMetadata {
  tenantId: string | null;
  actorName: string | null;
  actorRole: string | null;
  schoolName: string | null;
}

export class AuditService {
  log(input: AuditLogInput): Promise<void> {
    return this.enqueueWrite(() =>
      this.persist({
        ...input,
        actor: {
          userId: input.actorUserId ?? null,
          fullName: input.actorName ?? null,
          role: input.actorRole ?? null,
          schoolName: input.schoolName ?? null,
        },
      })
    );
  }

  logActivity(input: LogActivityInput): Promise<void> {
    return this.enqueueWrite(() => this.persist(input));
  }

  private enqueueWrite(task: () => Promise<void>): Promise<void> {
    try {
      const pending = task();
      void pending.catch(error => {
        rootLogger.error({ err: error }, 'Audit log write failed');
      });
    } catch (error) {
      rootLogger.error({ err: error }, 'Audit log write scheduling failed');
    }

    return Promise.resolve();
  }

  private async persist(input: LogActivityInput): Promise<void> {
    const requestContext = getAuditRequestContext();
    const normalizedPayload = normalizeAuditValue(input.payload);
    const extractedValues = extractOldAndNewValues(normalizedPayload);

    const actorUserId = input.actor?.userId ?? requestContext?.actor?.sub ?? null;

    let tenantId =
      input.tenantId ?? requestContext?.tenantId ?? requestContext?.actor?.tenantId ?? null;

    let actorName = input.actor?.fullName ?? buildActorName(requestContext?.actor) ?? null;

    let actorRole =
      input.actor?.role ??
      requestContext?.actor?.primaryRole ??
      resolvePrimaryRole(requestContext?.actor?.roles ?? []) ??
      null;

    let schoolName = input.actor?.schoolName ?? requestContext?.actor?.schoolName ?? null;

    if ((!tenantId || !actorName || !actorRole || !schoolName) && (actorUserId || tenantId)) {
      const resolvedMetadata = await this.resolveMetadata({
        actorUserId,
        tenantId,
      });

      tenantId = tenantId ?? resolvedMetadata.tenantId;
      actorName = actorName ?? resolvedMetadata.actorName;
      actorRole = actorRole ?? resolvedMetadata.actorRole;
      schoolName = schoolName ?? resolvedMetadata.schoolName;
    }

    if (!tenantId) {
      rootLogger.warn(
        {
          event: input.event,
          entity: input.entity,
          entityId: input.entityId,
        },
        'Skipping audit log because tenantId could not be resolved'
      );
      return;
    }

    const event =
      input.event ??
      buildLegacyAuditEvent({
        actionType: input.actionType ?? undefined,
        module: input.module ?? input.entity ?? undefined,
        entity: input.entity ?? undefined,
      });

    const recordId = input.recordId ?? input.entityId ?? null;
    const actionType = input.actionType ?? inferAuditActionType(event);
    const moduleName = input.module ?? inferAuditModule(event, input.entity ?? null);
    const status = input.status ?? inferAuditStatus(event);
    const requestId = input.requestId ?? requestContext?.requestId ?? null;
    const ipAddress = input.ipAddress ?? requestContext?.ipAddress ?? null;
    const userAgent = input.userAgent ?? requestContext?.userAgent ?? null;
    const device = input.device ?? buildDeviceLabel(userAgent);
    const sessionId =
      input.sessionId ?? requestContext?.sessionId ?? requestContext?.actor?.sessionId ?? null;

    const oldValue = normalizeAuditValue(
      input.oldValue === undefined ? extractedValues.oldValue : input.oldValue
    );
    const newValue = normalizeAuditValue(
      input.newValue === undefined ? extractedValues.newValue : input.newValue
    );

    await prisma.auditLog.create({
      data: {
        tenantId,
        actorUserId,
        actorName,
        actorRole,
        schoolName,
        event,
        actionType: actionType ?? undefined,
        module: moduleName ?? null,
        description: inferAuditDescription({
          description: input.description ?? undefined,
          event,
          entity: input.entity ?? undefined,
          recordId,
        }),
        entity: input.entity ?? null,
        entityId: input.entityId ?? null,
        recordId,
        requestId,
        ipAddress,
        userAgent,
        device,
        status,
        sessionId,
        oldValue: this.toJsonField(oldValue),
        newValue: this.toJsonField(newValue),
        payload: this.toJsonField(normalizedPayload),
      },
    });
  }

  private async resolveMetadata(input: {
    actorUserId: string | null;
    tenantId: string | null;
  }): Promise<ResolvedAuditMetadata> {
    const userDelegate = prisma.user as
      | (typeof prisma.user & {
          findUnique?: typeof prisma.user.findUnique;
        })
      | undefined;

    if (input.actorUserId && userDelegate && typeof userDelegate.findUnique === 'function') {
      const actor = await userDelegate.findUnique({
        where: { id: input.actorUserId },
        select: {
          tenantId: true,
          firstName: true,
          lastName: true,
          userRoles: {
            select: {
              role: {
                select: {
                  name: true,
                },
              },
            },
          },
          tenant: {
            select: {
              name: true,
              school: {
                select: {
                  displayName: true,
                },
              },
            },
          },
        },
      });

      if (actor) {
        return {
          tenantId: input.tenantId ?? actor.tenantId,
          actorName: buildActorName(actor),
          actorRole: resolvePrimaryRole(actor.userRoles.map(item => item.role.name)),
          schoolName: actor.tenant.school?.displayName ?? actor.tenant.name,
        };
      }
    }

    if (!input.tenantId) {
      return {
        tenantId: null,
        actorName: null,
        actorRole: null,
        schoolName: null,
      };
    }

    const tenantDelegate = prisma.tenant as
      | (typeof prisma.tenant & {
          findUnique?: typeof prisma.tenant.findUnique;
        })
      | undefined;

    const tenant =
      tenantDelegate && typeof tenantDelegate.findUnique === 'function'
        ? await tenantDelegate.findUnique({
            where: { id: input.tenantId },
            select: {
              name: true,
              school: {
                select: {
                  displayName: true,
                },
              },
            },
          })
        : null;

    return {
      tenantId: input.tenantId,
      actorName: null,
      actorRole: null,
      schoolName: tenant?.school?.displayName ?? tenant?.name ?? null,
    };
  }

  private toJsonField(value: unknown): Prisma.InputJsonValue | typeof Prisma.JsonNull | undefined {
    if (value === undefined) {
      return undefined;
    }

    if (value === null) {
      return Prisma.JsonNull;
    }

    return value as Prisma.InputJsonValue;
  }
}

import { AsyncLocalStorage } from 'async_hooks';
import { Request } from 'express';

import { JwtUser, RequestAuditContext } from '../types/auth.types';

export interface AuditRequestStore extends RequestAuditContext {
  actor?: JwtUser | null;
  tenantId?: string | null;
}

const auditRequestStorage = new AsyncLocalStorage<AuditRequestStore>();

function getHeaderValue(req: Request, header: string): string | null {
  const value = req.header(header);
  return value?.trim() ? value.trim() : null;
}

export function buildRequestAuditContext(req: Request): RequestAuditContext {
  return {
    requestId: req.requestId,
    ipAddress: req.ip ?? null,
    userAgent: req.header('user-agent') ?? null,
    sessionId: req.user?.sessionId ?? getHeaderValue(req, 'x-session-id'),
  };
}

export function runWithAuditRequestContext(
  req: Request,
  callback: () => void,
): void {
  auditRequestStorage.run(
    {
      ...buildRequestAuditContext(req),
      actor: req.user ?? null,
      tenantId: req.tenantId ?? req.user?.tenantId ?? null,
    },
    callback,
  );
}

export function getAuditRequestContext(): AuditRequestStore | undefined {
  return auditRequestStorage.getStore();
}

export function mergeAuditRequestContext(
  partial: Partial<AuditRequestStore>,
): void {
  const store = auditRequestStorage.getStore();
  if (!store) {
    return;
  }

  Object.assign(store, partial);
}

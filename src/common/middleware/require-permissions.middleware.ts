import { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app-error';
import { AUDIT_EVENT } from '../../constants/audit-events';
import { AuditService } from '../../modules/audit/audit.service';

const auditService = new AuditService();

function denyForMissingPermissions(
  req: Request,
  next: NextFunction,
  requiredPermissions: string[],
) {
  if (req.user?.tenantId) {
    void auditService.log({
      tenantId: req.user.tenantId,
      actorUserId: req.user.sub,
      event: AUDIT_EVENT.ACCESS_DENIED,
      requestId: req.requestId,
      ipAddress: req.ip ?? null,
      userAgent: req.header('user-agent') ?? null,
      payload: {
        requiredPermissions,
        route: req.originalUrl,
        method: req.method,
      },
    });
  }

  next(
    new AppError(
      403,
      'AUTH_INSUFFICIENT_PERMISSIONS',
      'Insufficient permissions',
      { requiredPermissions },
    ),
  );
}

export function requirePermissions(requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const isSuperAdmin = req.user?.roles?.includes('SUPER_ADMIN') ?? false;
    if (isSuperAdmin) {
      next();
      return;
    }

    const userPermissions = new Set(req.user?.permissions ?? []);
    const hasAll = requiredPermissions.every((permission) =>
      userPermissions.has(permission),
    );

    if (!hasAll) {
      denyForMissingPermissions(req, next, requiredPermissions);
      return;
    }

    next();
  };
}

export function requireAnyPermissions(requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const isSuperAdmin = req.user?.roles?.includes('SUPER_ADMIN') ?? false;
    if (isSuperAdmin) {
      next();
      return;
    }

    const userPermissions = new Set(req.user?.permissions ?? []);
    const hasAny = requiredPermissions.some((permission) => userPermissions.has(permission));

    if (!hasAny) {
      denyForMissingPermissions(req, next, requiredPermissions);
      return;
    }

    next();
  };
}

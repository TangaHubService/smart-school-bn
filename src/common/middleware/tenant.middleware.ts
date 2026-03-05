import { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app-error';

export function enforceTenant(
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  const tenantId = req.user?.tenantId;
  if (!tenantId) {
    next(new AppError(401, 'AUTH_UNAUTHORIZED', 'User tenant not found'));
    return;
  }

  const headerTenant = req.header('x-tenant-id');
  if (headerTenant && headerTenant !== tenantId) {
    next(new AppError(403, 'TENANT_MISMATCH', 'Tenant mismatch'));
    return;
  }

  req.tenantId = tenantId;
  next();
}

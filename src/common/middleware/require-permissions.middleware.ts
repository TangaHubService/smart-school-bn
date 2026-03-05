import { NextFunction, Request, Response } from 'express';

import { AppError } from '../errors/app-error';

export function requirePermissions(requiredPermissions: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const userPermissions = new Set(req.user?.permissions ?? []);
    const hasAll = requiredPermissions.every((permission) =>
      userPermissions.has(permission),
    );

    if (!hasAll) {
      next(
        new AppError(
          403,
          'AUTH_INSUFFICIENT_PERMISSIONS',
          'Insufficient permissions',
          { requiredPermissions },
        ),
      );
      return;
    }

    next();
  };
}

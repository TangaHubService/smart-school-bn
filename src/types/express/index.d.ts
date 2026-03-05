import type { JwtUser } from '../../common/types/auth.types';

declare global {
  namespace Express {
    interface Request {
      requestId: string;
      tenantId?: string;
      user?: JwtUser;
    }
  }
}

export {};

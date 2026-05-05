export interface JwtUser {
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
  firstName?: string;
  lastName?: string;
  primaryRole?: string;
  schoolName?: string | null;
  sessionId?: string;
}

export interface RequestAuditContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
  sessionId?: string | null;
}

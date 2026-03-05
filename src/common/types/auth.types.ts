export interface JwtUser {
  sub: string;
  tenantId: string;
  email: string;
  roles: string[];
  permissions: string[];
}

export interface RequestAuditContext {
  requestId: string;
  ipAddress: string | null;
  userAgent: string | null;
}

import { AuditActionType, AuditLogStatus } from '@prisma/client';

const ROLE_PRIORITY = [
  'SUPER_ADMIN',
  'SCHOOL_ADMIN',
  'ADMIN',
  'GOV_AUDITOR',
  'ACCOUNTANT',
  'TEACHER',
  'STUDENT',
  'PARENT',
  'PUBLIC_LEARNER',
] as const;

const MODULE_PREFIXES: Array<[prefix: string, module: string]> = [
  ['AUTH_', 'Authentication'],
  ['USER_PASSWORD_', 'Authentication'],
  ['TENANT_', 'Tenants'],
  ['SCHOOL_', 'Schools'],
  ['STAFF_', 'Staff'],
  ['STUDENT_', 'Students'],
  ['PARENT_', 'Parents'],
  ['ATTENDANCE_', 'Attendance'],
  ['CONDUCT_', 'Conduct'],
  ['COURSE_', 'Learning'],
  ['LESSON_', 'Learning'],
  ['ASSIGNMENT_', 'Learning'],
  ['SUBMISSION_', 'Learning'],
  ['ASSESSMENT_', 'Assessments'],
  ['EXAM_', 'Exams'],
  ['RESULTS_', 'Exams'],
  ['REPORT_CARD_', 'Exams'],
  ['GRADING_SCHEME_', 'Exams'],
  ['ANNOUNCEMENT_', 'Announcements'],
  ['TIMETABLE_', 'Timetable'],
  ['GOV_', 'Government'],
  ['SUBSCRIPTION_', 'Finance'],
  ['ACADEMY_', 'Finance'],
  ['SYSTEM_ANNOUNCEMENT_', 'System Announcements'],
  ['ACCESS_', 'Security'],
];

const SENSITIVE_FIELD_NAMES = new Set([
  'password',
  'passwordhash',
  'newpassword',
  'oldpassword',
  'confirmpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'authorization',
  'secret',
  'apikey',
  'apiKey',
  'otp',
  'hash',
  'salt',
  'cookie',
]);

const MAX_AUDIT_DEPTH = 5;
const MAX_AUDIT_ARRAY_ITEMS = 100;
const MAX_AUDIT_OBJECT_KEYS = 60;
const MAX_AUDIT_STRING_LENGTH = 4000;

function truncateString(value: string): string {
  if (value.length <= MAX_AUDIT_STRING_LENGTH) {
    return value;
  }

  return `${value.slice(0, MAX_AUDIT_STRING_LENGTH)}...[truncated]`;
}

function normalizeStringToken(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function humanizeToken(value: string): string {
  return value
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/\b\w/g, char => char.toUpperCase());
}

function isSensitiveFieldName(key: string): boolean {
  return SENSITIVE_FIELD_NAMES.has(key.toLowerCase());
}

function detectBrowser(userAgent: string): string | null {
  if (/edg\//i.test(userAgent)) return 'Edge';
  if (/chrome\//i.test(userAgent) && !/edg\//i.test(userAgent)) return 'Chrome';
  if (/firefox\//i.test(userAgent)) return 'Firefox';
  if (/safari\//i.test(userAgent) && !/chrome\//i.test(userAgent)) return 'Safari';
  if (/opr\//i.test(userAgent) || /opera/i.test(userAgent)) return 'Opera';
  if (/postmanruntime/i.test(userAgent)) return 'Postman';
  if (/insomnia/i.test(userAgent)) return 'Insomnia';
  return null;
}

function detectOperatingSystem(userAgent: string): string | null {
  if (/windows/i.test(userAgent)) return 'Windows';
  if (/android/i.test(userAgent)) return 'Android';
  if (/iphone|ipad|ios/i.test(userAgent)) return 'iOS';
  if (/mac os x|macintosh/i.test(userAgent)) return 'macOS';
  if (/linux/i.test(userAgent)) return 'Linux';
  return null;
}

export function buildActorName(
  input?: {
    firstName?: string | null;
    lastName?: string | null;
  } | null
): string | null {
  const fullName = `${input?.firstName ?? ''} ${input?.lastName ?? ''}`.trim();
  return fullName || null;
}

export function resolvePrimaryRole(roles: string[] = []): string | null {
  if (!roles.length) {
    return null;
  }

  const uniqueRoles = [...new Set(roles)];
  const ordered = uniqueRoles.sort((left, right) => {
    const leftPriority = ROLE_PRIORITY.indexOf(left as (typeof ROLE_PRIORITY)[number]);
    const rightPriority = ROLE_PRIORITY.indexOf(right as (typeof ROLE_PRIORITY)[number]);
    const normalizedLeft = leftPriority === -1 ? Number.MAX_SAFE_INTEGER : leftPriority;
    const normalizedRight = rightPriority === -1 ? Number.MAX_SAFE_INTEGER : rightPriority;

    if (normalizedLeft !== normalizedRight) {
      return normalizedLeft - normalizedRight;
    }

    return left.localeCompare(right);
  });

  return ordered[0] ?? null;
}

export function inferAuditActionType(event?: string | null): AuditActionType | null {
  if (!event) {
    return null;
  }

  if (event === 'AUTH_LOGOUT') {
    return AuditActionType.LOGOUT;
  }

  if (event === 'AUTH_LOGIN_SUCCESS' || event === 'AUTH_LOGIN_FAILED') {
    return AuditActionType.LOGIN;
  }

  if (event.endsWith('_DELETED') || event.endsWith('_REVOKED')) {
    return AuditActionType.DELETE;
  }

  if (
    event.endsWith('_CREATED') ||
    event.endsWith('_ADDED') ||
    event.endsWith('_ASSIGNED') ||
    event.includes('_LINKED') ||
    event.endsWith('_REQUESTED') ||
    event.endsWith('_COMMITTED') ||
    event.endsWith('_STARTED') ||
    event.endsWith('_GRANTED')
  ) {
    return AuditActionType.CREATE;
  }

  return AuditActionType.UPDATE;
}

export function inferAuditStatus(event?: string | null): AuditLogStatus {
  if (!event) {
    return AuditLogStatus.SUCCESS;
  }

  if (event.endsWith('_FAILED') || event.endsWith('_DENIED') || event.includes('ACCESS_DENIED')) {
    return AuditLogStatus.FAILED;
  }

  return AuditLogStatus.SUCCESS;
}

export function inferAuditModule(event?: string | null, entity?: string | null): string | null {
  if (event) {
    const match = MODULE_PREFIXES.find(([prefix]) => event.startsWith(prefix));
    if (match) {
      return match[1];
    }
  }

  return entity ? humanizeToken(entity) : null;
}

export function buildLegacyAuditEvent(input: {
  actionType?: AuditActionType | null;
  module?: string | null;
  entity?: string | null;
}): string {
  const moduleToken = (input.module ?? input.entity ?? 'GENERAL')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .toUpperCase();

  return `${moduleToken || 'GENERAL'}_${input.actionType ?? AuditActionType.UPDATE}`;
}

export function inferAuditDescription(input: {
  description?: string | null;
  event?: string | null;
  entity?: string | null;
  recordId?: string | null;
}): string {
  if (input.description?.trim()) {
    return truncateString(normalizeStringToken(input.description));
  }

  const base = input.event
    ? humanizeToken(input.event)
    : input.entity
      ? `Updated ${humanizeToken(input.entity)}`
      : 'Audit activity recorded';

  if (input.recordId) {
    return truncateString(`${base} (${input.recordId})`);
  }

  return truncateString(base);
}

export function buildDeviceLabel(userAgent?: string | null): string | null {
  if (!userAgent?.trim()) {
    return null;
  }

  const browser = detectBrowser(userAgent);
  const os = detectOperatingSystem(userAgent);

  if (browser && os) {
    return `${browser} on ${os}`;
  }

  if (browser) {
    return browser;
  }

  if (os) {
    return os;
  }

  return truncateString(userAgent);
}

export function normalizeAuditValue(value: unknown, depth = 0): unknown {
  if (value === undefined) {
    return undefined;
  }

  if (value === null) {
    return null;
  }

  if (typeof value === 'string') {
    return truncateString(value);
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value;
  }

  if (typeof value === 'bigint') {
    return value.toString();
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  if (Array.isArray(value)) {
    const items = value
      .slice(0, MAX_AUDIT_ARRAY_ITEMS)
      .map(item => normalizeAuditValue(item, depth + 1));

    if (value.length > MAX_AUDIT_ARRAY_ITEMS) {
      items.push(`[${value.length - MAX_AUDIT_ARRAY_ITEMS} more items truncated]`);
    }

    return items;
  }

  if (typeof value === 'object') {
    if (depth >= MAX_AUDIT_DEPTH) {
      return '[max depth reached]';
    }

    const entries = Object.entries(value as Record<string, unknown>);
    const limitedEntries = entries.slice(0, MAX_AUDIT_OBJECT_KEYS);
    const normalized = Object.fromEntries(
      limitedEntries.map(([key, entryValue]) => [
        key,
        isSensitiveFieldName(key) ? '[REDACTED]' : normalizeAuditValue(entryValue, depth + 1),
      ])
    );

    if (entries.length > MAX_AUDIT_OBJECT_KEYS) {
      normalized.__truncatedKeys = entries.length - MAX_AUDIT_OBJECT_KEYS;
    }

    return normalized;
  }

  return truncateString(String(value));
}

function pickObjectValue(object: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(object, key)) {
      return object[key];
    }
  }

  return undefined;
}

export function extractOldAndNewValues(payload: unknown): {
  oldValue?: unknown;
  newValue?: unknown;
} {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return {};
  }

  const record = payload as Record<string, unknown>;
  const oldValue = pickObjectValue(record, ['oldValue', 'before', 'previous', 'previousValue']);
  const newValue = pickObjectValue(record, ['newValue', 'after', 'next', 'nextValue']);

  return { oldValue, newValue };
}

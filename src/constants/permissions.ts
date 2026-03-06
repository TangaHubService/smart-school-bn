export const PERMISSIONS = {
  TENANTS_CREATE: 'tenants.create',
  TENANTS_READ: 'tenants.read',
  TENANTS_MANAGE: 'tenants.manage',

  SCHOOL_SETUP_MANAGE: 'school.setup.manage',

  ACADEMIC_YEAR_MANAGE: 'academic_year.manage',
  TERM_MANAGE: 'term.manage',
  GRADE_LEVEL_MANAGE: 'grade_level.manage',
  CLASS_ROOM_MANAGE: 'class_room.manage',
  SUBJECT_MANAGE: 'subject.manage',

  STAFF_INVITE: 'staff.invite',
  STUDENTS_READ: 'students.read',
  STUDENTS_MANAGE: 'students.manage',
  PARENTS_MANAGE: 'parents.manage',
  PARENT_MY_CHILDREN_READ: 'parents.my_children.read',
  USERS_READ: 'users.read',
  ROLES_READ: 'roles.read',
} as const;

export const SUPER_ADMIN_PERMISSIONS = [
  PERMISSIONS.TENANTS_CREATE,
  PERMISSIONS.TENANTS_READ,
  PERMISSIONS.TENANTS_MANAGE,
  PERMISSIONS.USERS_READ,
  PERMISSIONS.ROLES_READ,
];

export const SCHOOL_ADMIN_PERMISSIONS = [
  PERMISSIONS.SCHOOL_SETUP_MANAGE,
  PERMISSIONS.ACADEMIC_YEAR_MANAGE,
  PERMISSIONS.TERM_MANAGE,
  PERMISSIONS.GRADE_LEVEL_MANAGE,
  PERMISSIONS.CLASS_ROOM_MANAGE,
  PERMISSIONS.SUBJECT_MANAGE,
  PERMISSIONS.STAFF_INVITE,
  PERMISSIONS.STUDENTS_READ,
  PERMISSIONS.STUDENTS_MANAGE,
  PERMISSIONS.PARENTS_MANAGE,
  PERMISSIONS.USERS_READ,
  PERMISSIONS.ROLES_READ,
];

export interface DefaultRoleDefinition {
  name: string;
  description: string;
  isSystem: boolean;
  permissions: string[];
}

export function buildDefaultTenantRoles(): DefaultRoleDefinition[] {
  return [
    {
      name: 'SCHOOL_ADMIN',
      description: 'School administrator role',
      isSystem: true,
      permissions: SCHOOL_ADMIN_PERMISSIONS,
    },
    {
      name: 'TEACHER',
      description: 'Teacher role',
      isSystem: true,
      permissions: ['students.read', 'attendance.manage'],
    },
    {
      name: 'PARENT',
      description: 'Parent portal role',
      isSystem: true,
      permissions: [PERMISSIONS.PARENT_MY_CHILDREN_READ],
    },
  ];
}

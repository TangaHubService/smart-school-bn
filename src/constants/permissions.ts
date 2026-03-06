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
  STUDENT_MY_COURSES_READ: 'students.my_courses.read',
  ATTENDANCE_READ: 'attendance.read',
  ATTENDANCE_MANAGE: 'attendance.manage',
  COURSES_READ: 'courses.read',
  COURSES_MANAGE: 'courses.manage',
  LESSONS_MANAGE: 'lessons.manage',
  LESSONS_PUBLISH: 'lessons.publish',
  ASSIGNMENTS_MANAGE: 'assignments.manage',
  ASSIGNMENTS_SUBMIT: 'assignments.submit',
  ASSESSMENTS_READ: 'assessments.read',
  ASSESSMENTS_MANAGE: 'assessments.manage',
  ASSESSMENTS_PUBLISH: 'assessments.publish',
  ASSESSMENTS_SUBMIT: 'assessments.submit',
  ASSESSMENT_RESULTS_READ: 'assessment_results.read',
  SUBMISSIONS_READ: 'submissions.read',
  SUBMISSIONS_GRADE: 'submissions.grade',
  FILES_UPLOAD: 'files.upload',
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
  PERMISSIONS.ATTENDANCE_READ,
  PERMISSIONS.ATTENDANCE_MANAGE,
  PERMISSIONS.COURSES_READ,
  PERMISSIONS.COURSES_MANAGE,
  PERMISSIONS.LESSONS_MANAGE,
  PERMISSIONS.LESSONS_PUBLISH,
  PERMISSIONS.ASSIGNMENTS_MANAGE,
  PERMISSIONS.ASSESSMENTS_READ,
  PERMISSIONS.ASSESSMENTS_MANAGE,
  PERMISSIONS.ASSESSMENTS_PUBLISH,
  PERMISSIONS.ASSESSMENT_RESULTS_READ,
  PERMISSIONS.SUBMISSIONS_READ,
  PERMISSIONS.SUBMISSIONS_GRADE,
  PERMISSIONS.FILES_UPLOAD,
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
      permissions: [
        PERMISSIONS.STUDENTS_READ,
        PERMISSIONS.ATTENDANCE_READ,
        PERMISSIONS.ATTENDANCE_MANAGE,
        PERMISSIONS.COURSES_READ,
        PERMISSIONS.COURSES_MANAGE,
        PERMISSIONS.LESSONS_MANAGE,
        PERMISSIONS.LESSONS_PUBLISH,
        PERMISSIONS.ASSIGNMENTS_MANAGE,
        PERMISSIONS.ASSESSMENTS_READ,
        PERMISSIONS.ASSESSMENTS_MANAGE,
        PERMISSIONS.ASSESSMENTS_PUBLISH,
        PERMISSIONS.ASSESSMENT_RESULTS_READ,
        PERMISSIONS.SUBMISSIONS_READ,
        PERMISSIONS.SUBMISSIONS_GRADE,
        PERMISSIONS.FILES_UPLOAD,
      ],
    },
    {
      name: 'STUDENT',
      description: 'Student portal role',
      isSystem: true,
      permissions: [
        PERMISSIONS.STUDENT_MY_COURSES_READ,
        PERMISSIONS.ASSIGNMENTS_SUBMIT,
        PERMISSIONS.ASSESSMENTS_SUBMIT,
        PERMISSIONS.FILES_UPLOAD,
      ],
    },
    {
      name: 'PARENT',
      description: 'Parent portal role',
      isSystem: true,
      permissions: [PERMISSIONS.PARENT_MY_CHILDREN_READ],
    },
  ];
}

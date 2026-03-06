# Sprint 2: Students & Parents

## User Stories + Acceptance Criteria

### SchoolAdmin - Enroll student
- Can create a student with required profile fields and active enrollment (academic year + class).
- Cannot create duplicate `studentCode` inside the same tenant.
- Can update student profile and move enrollment safely.
- Exactly one active enrollment exists per student after updates.

### SchoolAdmin - Bulk import students
- Can upload CSV and see row-by-row preview with validation errors.
- Can commit valid rows only (`allowPartial=true`) or fail fast when invalid rows exist.
- Import returns summary: total, valid, invalid, imported, skipped.

### Parent - View linked students
- Parent user can only view students linked to their own parent profile.
- Parent cannot access SchoolAdmin-only endpoints.

## CSV Import Format
Supported headers (aliases allowed):
- `studentCode`, `firstName`, `lastName`
- `gender` (`MALE|FEMALE|OTHER|UNDISCLOSED`) optional
- `dateOfBirth` (`YYYY-MM-DD` or ISO) optional
- `academicYearId` or `academicYear`
- `classRoomId` or `classCode`
- `enrolledAt` optional

## API + RBAC
- `POST /students` -> `students.manage`
- `GET /students` -> `students.read`
- `PATCH /students/:id` -> `students.manage`
- `POST /students/import` -> `students.manage`
- `GET /students/export` -> `students.read`
- `GET /parents` -> `parents.manage`
- `POST /parents` -> `parents.manage`
- `POST /parents/:id/link-student` -> `parents.manage`
- `GET /parents/me/students` -> `parents.my_children.read`

## Audit Events
- `STUDENT_CREATED`
- `STUDENT_UPDATED`
- `STUDENT_ENROLLMENT_CHANGED`
- `STUDENT_IMPORT_COMMITTED`
- `PARENT_CREATED`
- `PARENT_LINKED_TO_STUDENT`

## Test Coverage
- Integration: student enroll -> list filter -> export
- Integration: import preview -> commit (partial success)
- Unit: parent RBAC boundaries

Run:
- `npm run build`
- `npm test`
- `npm run test:integration`

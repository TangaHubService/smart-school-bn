# Sprint 1 - Smart School Rwanda

## 1) User Stories + Acceptance Criteria

### SuperAdmin
- Story: As a SuperAdmin, I can create a new school tenant with a SchoolAdmin account in one action.
- Acceptance:
  - `POST /tenants` creates tenant + school + default roles + school admin user atomically.
  - Duplicate tenant code/domain/admin email returns conflict error.
  - Action is audit logged as `TENANT_CREATED`.

### SchoolAdmin
- Story: As a SchoolAdmin, I can complete school setup with academic year, terms, levels/classes, and subjects.
- Acceptance:
  - `POST /schools/setup` upserts school profile and setup entities in one transaction.
  - Invalid date ranges are blocked with validation error.
  - Setup can be completed in one guided wizard submission.
  - Action is audit logged as `SCHOOL_SETUP_UPDATED`.

### SchoolAdmin (Staff)
- Story: As a SchoolAdmin, I can invite staff and track invite status.
- Acceptance:
  - `POST /staff/invite` creates invite token and audit event.
  - `POST /staff/accept-invite` creates/updates user, assigns role, marks invite accepted atomically.
  - Expired or already-used invites are rejected.
  - Invite acceptance is audit logged as `STAFF_INVITE_ACCEPTED`.

## 2) Prisma Additions
- Added models:
  - `School`
  - `Invite`
  - `AcademicYear`
  - `Term`
  - `GradeLevel`
  - `ClassRoom`
  - `Subject`
- Added enum: `InviteStatus`
- Added relations on `Tenant`, `User`, `Role`.
- Added migration: `prisma/migrations/20260306021000_sprint1_setup_foundation/migration.sql`

## 3) API Endpoints + RBAC

### Tenant + Setup
- `POST /tenants` permission: `tenants.create`
- `POST /schools/setup` permission: `school.setup.manage`
- `GET /schools/setup-status` permission: `school.setup.manage`

### Academics CRUD
- `POST/GET/PATCH/DELETE /academic-years` permission: `academic_year.manage`
- `POST/GET/PATCH/DELETE /terms` permission: `term.manage`
- `POST/GET/PATCH/DELETE /grade-levels` permission: `grade_level.manage`
- `POST/GET/PATCH/DELETE /classes` permission: `class_room.manage`
- `POST/GET/PATCH/DELETE /subjects` permission: `subject.manage`

### Staff Invites
- `POST /staff/invite` permission: `staff.invite`
- `GET /staff/invites` permission: `staff.invite`
- `POST /staff/accept-invite` public endpoint

## 4) Backend Implementation Notes
- Transactions used in:
  - Tenant creation bootstrap
  - School setup submission
  - Invite acceptance
- Tenant scoping:
  - Authenticated routes use `authenticate` + `enforceTenant` middleware.
  - Service queries always include `tenantId` filter.
- Audit events:
  - `TENANT_CREATED`
  - `SCHOOL_SETUP_UPDATED`
  - `STAFF_INVITE_CREATED`
  - `STAFF_INVITE_ACCEPTED`

## 5) Frontend Implementation
- Added screens:
  - `/tenants/new` (SuperAdmin onboarding form)
  - `/setup` (5-step setup wizard)
  - `/academics` (responsive forms + tables)
  - `/staff` (invite form + invite list)
  - `/accept-invite` (public invite acceptance)
- UX:
  - Inline validation via RHF + Zod
  - Empty states for tables
  - Safe updates (no unsafe optimistic writes)

## 6) Testing
- Integration:
  - `create tenant -> setup complete` flow test
- Unit:
  - Invite acceptance service tests
  - RBAC permission tests for `tenants.create`

## 7) Done Checklist
- [x] Schema + migration committed
- [x] Seed updated for `SUPER_ADMIN` + `SCHOOL_ADMIN`
- [x] Permissions matrix implemented in middleware and documented
- [x] Audit logs for Sprint 1 critical actions
- [x] Backend build + unit + integration tests pass
- [x] Frontend build passes
- [x] API + setup docs updated

## Permissions Matrix

| Endpoint | Method | Permission |
|---|---|---|
| `/tenants` | POST | `tenants.create` |
| `/schools/setup-status` | GET | `school.setup.manage` |
| `/schools/setup` | POST | `school.setup.manage` |
| `/academic-years` | POST/GET | `academic_year.manage` |
| `/academic-years/:id` | PATCH/DELETE | `academic_year.manage` |
| `/terms` | POST/GET | `term.manage` |
| `/terms/:id` | PATCH/DELETE | `term.manage` |
| `/grade-levels` | POST/GET | `grade_level.manage` |
| `/grade-levels/:id` | PATCH/DELETE | `grade_level.manage` |
| `/classes` | POST/GET | `class_room.manage` |
| `/classes/:id` | PATCH/DELETE | `class_room.manage` |
| `/subjects` | POST/GET | `subject.manage` |
| `/subjects/:id` | PATCH/DELETE | `subject.manage` |
| `/staff/invite` | POST | `staff.invite` |
| `/staff/invites` | GET | `staff.invite` |
| `/staff/accept-invite` | POST | Public |

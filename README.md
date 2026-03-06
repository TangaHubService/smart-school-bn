# Smart School Rwanda Backend (Node.js + Express)

## Quick start
1. `cp .env.example .env`
2. `npm install`
3. `npm run prisma:generate`
4. `npm run prisma:migrate:dev`
5. `npm run prisma:seed`
6. `npm run start:dev`

## Endpoints
- `POST /auth/login`
- `POST /auth/refresh`
- `POST /auth/logout`
- `GET /me`
- `GET /health`
- `GET /meta/version`
- `POST /tenants` (SuperAdmin)
- `POST /schools/setup` (SchoolAdmin)
- `GET /schools/setup-status`
- `POST/GET/PATCH/DELETE /academic-years`
- `POST/GET/PATCH/DELETE /terms`
- `POST/GET/PATCH/DELETE /grade-levels`
- `POST/GET/PATCH/DELETE /classes`
- `POST/GET/PATCH/DELETE /subjects`
- `POST /staff/invite`
- `POST /staff/accept-invite`
- `GET /staff/invites`

## Tests
- Unit: `npm test`
- Integration: `npm run test:integration`

## Notes
- Access token is JWT (`Authorization: Bearer ...`)
- Refresh token is opaque and hashed at rest
- Tenant isolation enforced through auth payload + `x-tenant-id` mismatch protection

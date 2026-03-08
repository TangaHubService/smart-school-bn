## Conduct Marks Migration Plan

### Safe Deploy
1. Deploy backend code with `FEATURE_CONDUCT_MARKS_ENABLED=false` in backend and frontend envs.
2. Run `npm run prisma:migrate:deploy` on backend.
3. Run `npm run prisma:generate` and restart backend instances.
4. Validate existing endpoints:
   - `/conduct/incidents`
   - `/gov/dashboard`
   - exams results lock/publish flows
5. Enable `FEATURE_CONDUCT_MARKS_ENABLED=true` and redeploy frontend/backend.

### Rollback Plan
1. Disable `FEATURE_CONDUCT_MARKS_ENABLED=false` to remove new mark UI/endpoints from active use.
2. Roll back backend application to the previous release.
3. Keep DB changes in place (non-destructive additive migration). Existing legacy endpoints continue working.
4. If hard DB rollback is required, execute in order:
   - drop FK/check constraints added by migration
   - drop `ConductMark` and `ConductConfig` tables
   - drop new indexes
   - remove `conductMarkId` and nullable change on `ConductFeedback`
   - remove `termId` and `deductionPoints` from `ConductIncident`
   - drop enum `ConductMarkMethod`

### Note
Database rollback should only be used during controlled maintenance windows due data-loss risk for newly captured conduct marks/feedback.

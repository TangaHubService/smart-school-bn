# Timetable not showing in deployed version

The Timetable link and page can be missing in production for two main reasons.

## 1. Roles missing timetable permissions

The sidebar shows **Timetable** only to users whose role includes `timetable.read`. If production was deployed or seeded before timetable permissions were added, existing SCHOOL_ADMIN and TEACHER roles may not have them.

**Fix:** Run the one-off script to add timetable permissions to all existing SCHOOL_ADMIN and TEACHER roles:

```bash
cd smart-school-bn
npm run prisma:add-timetable-permissions
```

This updates only role permissions (adds `timetable.read` and `timetable.manage` where missing). Safe to run multiple times.

## 2. School setup not complete

The Timetable nav item and route are shown only when **school setup is complete** (e.g. academic years, terms, classes configured). If the school has not finished the setup wizard in production, the Timetable link is hidden.

**Fix:** Complete the school setup in the deployed app (e.g. **Schools Management** / **Setup**), then the Timetable item will appear for users with the right role and permissions.

---

**Summary:** Ensure (1) SCHOOL_ADMIN and TEACHER roles have `timetable.read` (run the script above if needed) and (2) the school’s setup is marked complete in production.

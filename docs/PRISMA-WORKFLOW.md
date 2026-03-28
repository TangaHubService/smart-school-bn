# Prisma migrations — team workflow

Follow this whenever `prisma/schema.prisma` changes so local, staging, and production stay aligned and you avoid P3009 / checksum / “column does not exist” surprises.

## Local development

- Create and apply migrations with **`npx prisma migrate dev`** (not `db push` for shared history). Use `db push` only for quick throwaway experiments.
- Commit **both** `schema.prisma` and the new folder under **`prisma/migrations/`**.
- Before you start a schema change: **`git pull`**, then **`npx prisma migrate dev`** so your DB has everyone else’s migrations first. Then edit the schema and run **`npx prisma migrate dev --name describe_your_change`**.
- If your local DB is corrupted beyond repair, **`npx prisma migrate reset`** is OK **on local only** (wipes data).

## Shared / production

- Use **`npx prisma migrate deploy`** only (never `migrate dev` or `db push` on production).
- Prefer running deploy from the **same app image or release** that contains the matching `prisma/migrations` files.
- If a migration is **failed** (P3009), fix the cause, then use **`prisma migrate resolve`** (`--rolled-back` or `--applied` as documented), then **`migrate deploy`** again.
- Take **database backups** before production deploys when your host supports it.

## Habits that prevent pain

- One feature branch ≈ one coherent schema change; **pull main before** generating a migration.
- **Do not edit** migrations that are already applied on shared environments unless you follow Prisma’s patching/hotfix docs (checksums matter).
- Run **`npx prisma migrate status`** when something feels wrong.
- Occasionally test against a **fresh** local DB (`migrate reset`) after big migration chains.

## NPM shortcuts (this repo)

- `npm run prisma:migrate:dev` — local migrate dev  
- `npm run prisma:migrate:deploy` — staging/production  
- `npm run prisma:migrate:status` — check history  
- `npm run prisma:migrate:resolve:rolled-back -- <migration_name>` — clear a failed migration row before redeploying  

See also: [Prisma — Development and production](https://www.prisma.io/docs/orm/prisma-migrate/workflows/development-and-production), [migrate resolve](https://www.prisma.io/docs/cli/migrate/resolve).

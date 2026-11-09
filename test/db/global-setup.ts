import { execSync } from 'child_process';
import path from 'path';

import { PrismaClient } from '@prisma/client';

import { resolveTestDatabaseUrl } from './test-database-url';

/** Creates the `_test` database if needed and applies every migration to it. */
export default async function globalSetup(): Promise<void> {
  const url = resolveTestDatabaseUrl();
  const databaseName = new URL(url).pathname.replace(/^\//, '');

  const admin = new URL(url);
  admin.pathname = '/postgres';
  const client = new PrismaClient({ datasourceUrl: admin.toString() });
  try {
    const rows = await client.$queryRaw<Array<{ exists: boolean }>>`
      SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = ${databaseName}) AS "exists"`;
    if (!rows[0]?.exists) {
      await client.$executeRawUnsafe(`CREATE DATABASE "${databaseName.replace(/"/g, '')}"`);
    }
  } finally {
    await client.$disconnect();
  }

  execSync('npx prisma migrate deploy', {
    cwd: path.resolve(__dirname, '../..'),
    env: { ...process.env, DATABASE_URL: url },
    stdio: 'pipe',
  });
}

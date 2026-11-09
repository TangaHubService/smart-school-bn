import fs from 'fs';
import path from 'path';

/**
 * Resolves the database the DB-backed suites run against.
 *
 * TEST_DATABASE_URL wins. Otherwise the server/credentials of DATABASE_URL (from
 * the environment or .env) are reused with the database renamed to
 * `smart_school_test`. Any URL whose database name does not end in `_test` is
 * refused, so these suites can never touch a development or production database.
 */
export function resolveTestDatabaseUrl(): string {
  let url = process.env.TEST_DATABASE_URL;

  if (!url) {
    let base = process.env.DATABASE_URL;
    if (!base) {
      const envFile = path.resolve(__dirname, '../../.env');
      if (fs.existsSync(envFile)) {
        const line = fs
          .readFileSync(envFile, 'utf8')
          .split('\n')
          .find(entry => entry.startsWith('DATABASE_URL='));
        base = line?.slice('DATABASE_URL='.length).trim().replace(/^"|"$/g, '');
      }
    }
    if (!base) {
      throw new Error('Set TEST_DATABASE_URL (or DATABASE_URL) to run the database test suites');
    }
    const parsed = new URL(base);
    parsed.pathname = '/smart_school_test';
    url = parsed.toString();
  }

  const databaseName = new URL(url).pathname.replace(/^\//, '');
  if (!databaseName.endsWith('_test')) {
    throw new Error(
      `Refusing to run DB tests against "${databaseName}": the database name must end with "_test"`
    );
  }
  return url;
}

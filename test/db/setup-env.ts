import { resolveTestDatabaseUrl } from './test-database-url';

// Runs before any module import in each test file, so src/config/env.ts and the
// Prisma client both see the isolated `_test` database.
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.JWT_ACCESS_SECRET = 'db-test-access-secret-0123456789abcdef';
process.env.JWT_REFRESH_SECRET = 'db-test-refresh-secret-0123456789abcdef';
process.env.OTP_HASH_SECRET = 'db-test-otp-hash-secret';
process.env.PAYPACK_WEBHOOK_SECRET = 'db-test-paypack-webhook-secret';
process.env.EMAIL_LOG_ONLY = 'true';
process.env.LOG_LEVEL = 'silent';
process.env.BCRYPT_ROUNDS = '8';
process.env.CORS_ORIGIN = 'http://localhost:5173';

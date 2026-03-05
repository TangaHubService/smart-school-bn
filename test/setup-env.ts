process.env.NODE_ENV = 'test';
process.env.DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@localhost:5432/smart_school_test';
process.env.JWT_ACCESS_SECRET =
  process.env.JWT_ACCESS_SECRET ?? '12345678901234567890123456789012';
process.env.JWT_REFRESH_SECRET =
  process.env.JWT_REFRESH_SECRET ?? 'abcdefghijklmnopqrstuvwxyz123456';
process.env.ACCESS_TOKEN_TTL = process.env.ACCESS_TOKEN_TTL ?? '15m';
process.env.REFRESH_TOKEN_TTL_DAYS = process.env.REFRESH_TOKEN_TTL_DAYS ?? '7';
process.env.CORS_ORIGIN = process.env.CORS_ORIGIN ?? '*';
process.env.APP_VERSION = process.env.APP_VERSION ?? '0.1.0';
process.env.COMMIT_SHA = process.env.COMMIT_SHA ?? 'test-sha';
process.env.BUILD_TIME = process.env.BUILD_TIME ?? '2026-03-06T00:00:00.000Z';

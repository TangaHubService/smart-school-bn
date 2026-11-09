import type { Config } from 'jest';

/**
 * Integration suites that run the real Express app against a real, migrated
 * PostgreSQL database (`*_test` only; see test/db/test-database-url.ts).
 * Run with `npm run test:db`.
 */
const config: Config = {
  testEnvironment: 'node',
  roots: ['<rootDir>/test/db'],
  testMatch: ['**/*.db.spec.ts'],
  globalSetup: '<rootDir>/test/db/global-setup.ts',
  setupFiles: ['<rootDir>/test/db/setup-env.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  moduleFileExtensions: ['ts', 'js'],
  // Suites share one database; run them one at a time.
  maxWorkers: 1,
  testTimeout: 30000,
};

export default config;

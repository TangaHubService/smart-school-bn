import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

// Some deployments (and older .env files) name the mail settings EMAIL_HOST /
// EMAIL_PORT / EMAIL_USER / EMAIL_PASSWORD, while the mailer reads SMTP_*.
// Accept both so mail is not silently disabled; SMTP_* wins when both are set.
const SMTP_ALIASES: Array<[string, string]> = [
  ['SMTP_HOST', 'EMAIL_HOST'],
  ['SMTP_PORT', 'EMAIL_PORT'],
  ['SMTP_USER', 'EMAIL_USER'],
  ['SMTP_PASS', 'EMAIL_PASSWORD'],
];
for (const [canonical, alias] of SMTP_ALIASES) {
  if (!process.env[canonical] && process.env[alias]) {
    process.env[canonical] = process.env[alias];
  }
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(16).default(12),
   OTP_TTL_MIN: z.coerce.number().int().positive().default(5),
   OTP_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
   OTP_RESEND_COOLDOWN_MIN: z.coerce.number().int().positive().default(2),
   OTP_HASH_SECRET: z.string().min(16).default('change-this-secret'),
   CORS_ORIGIN: z.string().default('*'),
   LOG_LEVEL: z.string().default('info'),
  APP_VERSION: z.string().default('0.1.0'),
  COMMIT_SHA: z.string().default('local-dev'),
  BUILD_TIME: z.string().default(new Date().toISOString()),
  APP_WEB_URL: z.string().url().default('http://localhost:5173'),
  EMAIL_FROM: z.string().email().default('no-reply@smartschool.rw'),
  /** Force emails to be logged instead of sent, even when SMTP is configured (testing). */
  EMAIL_LOG_ONLY: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER_PREFIX: z.string().default('smart-school'),
  /** School conduct *incidents* API (discipline cases). Conduct *marks* use `/conduct-marks` and stay enabled. */
  FEATURE_CONDUCT_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
  FEATURE_GOV_AUDITING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  FEATURE_ASSESSMENTS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform(value => value === 'true'),
  PAYPACK_CLIENT_ID: z.string().optional(),
  PAYPACK_CLIENT_SECRET: z.string().optional(),
  PAYPACK_BASE_URL: z.string().url().default('https://payments.paypack.rw/api'),
  PAYPACK_API_BASE_URL: z.string().url().optional(),
  PAYPACK_WEBHOOK_SECRET: z.string().optional(),
  PAYPACK_WEBHOOK_MODE: z.string().optional(),
  PAYPACK_INITIATE_PATH: z.string().optional(),
  ACADEMY_CATALOG_TENANT_ID: z.string().uuid().optional(),
  ACADEMY_TRIAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
  /** Offer the 100 RWF / 1 day "test" academy plan (payment smoke tests only). */
  ACADEMY_TEST_PLAN_ENABLED: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
  /** Annual school subscription price in RWF (one invoice per school per year). */
  BILLING_ANNUAL_AMOUNT_RWF: z.coerce.number().int().positive().default(250000),
  /** Allows simulated instant payments for demos/tests. Never enable in production. */
  BILLING_ALLOW_MOCK: z
    .enum(['true', 'false'])
    .default('false')
    .transform(value => value === 'true'),
  /** Shown on /health/info for ops / demo (e.g. Kigali, RW). */
  DEPLOY_REGION: z.string().max(120).optional().default(''),
  /** Source for EAC administrative division reference data (country/province/district/... lookups). */
  OPENADMINDATA_API_BASE_URL: z.string().url().default('https://api.openadmindata.org/api/v1'),
  /**
   * Express `trust proxy` setting so rate limits see the real client IP behind a
   * load balancer. Number of proxy hops (e.g. 1), or 'false' when exposed directly.
   */
  TRUST_PROXY: z
    .string()
    .default('false')
    .transform(value => (/^\d+$/.test(value) ? Number(value) : value === 'true')),
});

const DEFAULT_OTP_HASH_SECRET = 'change-this-secret';

/**
 * Production must not run on development conveniences. Each of these silently
 * weakens security if forgotten, so the process refuses to start instead.
 */
const productionSafeEnvSchema = envSchema.superRefine((value, ctx) => {
  if (value.NODE_ENV !== 'production') return;

  const problem = (path: string, message: string) =>
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: [path], message });

  if (!process.env.CORS_ORIGIN || value.CORS_ORIGIN.trim() === '*') {
    problem('CORS_ORIGIN', 'Set CORS_ORIGIN to the web app origin(s); "*" is not allowed in production');
  }
  if (!process.env.OTP_HASH_SECRET || value.OTP_HASH_SECRET === DEFAULT_OTP_HASH_SECRET) {
    problem('OTP_HASH_SECRET', 'Set a unique OTP_HASH_SECRET (at least 16 characters) in production');
  }
  if (value.BILLING_ALLOW_MOCK) {
    problem('BILLING_ALLOW_MOCK', 'Mock billing activates plans without payment and cannot be enabled in production');
  }
  if (value.PAYPACK_CLIENT_ID && !value.PAYPACK_WEBHOOK_SECRET) {
    problem('PAYPACK_WEBHOOK_SECRET', 'Paypack is configured but PAYPACK_WEBHOOK_SECRET is missing, so payments can never be confirmed');
  }
  if (!value.EMAIL_LOG_ONLY && !(value.SMTP_HOST && value.SMTP_PORT)) {
    problem('SMTP_HOST', 'Set SMTP_HOST and SMTP_PORT (or EMAIL_LOG_ONLY=true); otherwise invites, sign-in codes and password resets are never sent');
  }
});

const parsed = productionSafeEnvSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;

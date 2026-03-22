import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  DATABASE_URL: z.string().min(1),
  JWT_ACCESS_SECRET: z.string().min(32),
  JWT_REFRESH_SECRET: z.string().min(32),
  ACCESS_TOKEN_TTL: z.string().default('15m'),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  BCRYPT_ROUNDS: z.coerce.number().int().min(8).max(16).default(12),
  CORS_ORIGIN: z.string().default('*'),
  LOG_LEVEL: z.string().default('info'),
  APP_VERSION: z.string().default('0.1.0'),
  COMMIT_SHA: z.string().default('local-dev'),
  BUILD_TIME: z.string().default(new Date().toISOString()),
  APP_WEB_URL: z.string().url().default('http://localhost:5173'),
  EMAIL_FROM: z.string().email().default('no-reply@smartschool.rw'),
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().optional(),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_SECURE: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
  CLOUDINARY_CLOUD_NAME: z.string().optional(),
  CLOUDINARY_API_KEY: z.string().optional(),
  CLOUDINARY_API_SECRET: z.string().optional(),
  CLOUDINARY_FOLDER_PREFIX: z.string().default('smart-school'),
  FEATURE_CONDUCT_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  FEATURE_GOV_AUDITING_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  FEATURE_ASSESSMENTS_ENABLED: z
    .enum(['true', 'false'])
    .default('true')
    .transform((value) => value === 'true'),
  PAYPACK_CLIENT_ID: z.string().optional(),
  PAYPACK_CLIENT_SECRET: z.string().optional(),
  PAYPACK_BASE_URL: z.string().url().default('https://payments.paypack.rw/api'),
  PAYPACK_WEBHOOK_SECRET: z.string().optional(),
  PAYPACK_WEBHOOK_MODE: z.string().default('development'),
  ACADEMY_CATALOG_TENANT_ID: z.string().uuid().optional(),
  ACADEMY_TRIAL_HOURS: z.coerce.number().int().min(1).max(168).default(24),
});

const parsed = envSchema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration', parsed.error.flatten());
  throw new Error('Invalid environment configuration');
}

export const env = parsed.data;

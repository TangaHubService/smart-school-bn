import crypto from 'crypto';
import type { Request } from 'express';
import { ipKeyGenerator, rateLimit, type Options } from 'express-rate-limit';

import { env } from '../../config/env';
import { sendError } from '../utils/response';

/**
 * Abuse limits for unauthenticated entry points.
 *
 * Rwandan schools often reach the internet through one shared public IP, so a
 * whole classroom signs in from the same address. Credential limits are keyed
 * by IP *and* account identifier; only a generous ceiling is per IP alone.
 *
 * Counters live in process memory. With more than one API instance, plug a
 * shared store (e.g. rate-limit-redis) into `baseOptions.store`.
 */

const FIFTEEN_MINUTES = 15 * 60 * 1000;

function clientIp(req: Request): string {
  return ipKeyGenerator(req.ip ?? 'unknown');
}

function hashed(value: unknown): string {
  return crypto
    .createHash('sha256')
    .update(
      String(value ?? '')
        .trim()
        .toLowerCase()
    )
    .digest('hex')
    .slice(0, 32);
}

const baseOptions: Partial<Options> = {
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  // Unit/integration tests drive these routes many times in a row.
  skip: () => env.NODE_ENV === 'test',
  handler: (req, res, _next, options) => {
    sendError(
      req,
      res,
      options.statusCode,
      'RATE_LIMITED',
      'Too many attempts. Please wait a few minutes and try again.',
      { retryAfterSeconds: Math.ceil(options.windowMs / 1000) }
    );
  },
};

/** Password attempts: 10 per account per IP per 15 minutes. */
export const loginAttemptLimiter = rateLimit({
  ...baseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  keyGenerator: req => `login:${clientIp(req)}:${hashed(req.body?.identifier)}`,
});

/** Ceiling for one network: 300 credential requests per 15 minutes (a full school logging in). */
export const loginNetworkLimiter = rateLimit({
  ...baseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 300,
  keyGenerator: req => `login-net:${clientIp(req)}`,
});

/** One-time-code and challenge steps: 10 per challenge (or email) per 15 minutes. */
export const codeAttemptLimiter = rateLimit({
  ...baseOptions,
  windowMs: FIFTEEN_MINUTES,
  limit: 10,
  keyGenerator: req =>
    `code:${clientIp(req)}:${hashed(req.body?.challengeToken ?? req.body?.email)}`,
});

/** Anonymous forms (public support tickets, self-registration): 10 per IP per hour. */
export const publicFormLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 60 * 1000,
  limit: 10,
  keyGenerator: req => `form:${clientIp(req)}`,
});

/** Payment provider callbacks: 120 per IP per minute. */
export const webhookLimiter = rateLimit({
  ...baseOptions,
  windowMs: 60 * 1000,
  limit: 120,
  keyGenerator: req => `webhook:${clientIp(req)}`,
});

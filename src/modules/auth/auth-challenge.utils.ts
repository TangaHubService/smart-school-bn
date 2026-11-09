import crypto from 'crypto';
import jwt from 'jsonwebtoken';

import { env } from '../../config/env';
import { AppError } from '../../common/errors/app-error';

/**
 * Short-lived, signed tokens that carry a half-finished login between steps
 * (forced password change). They replace the old
 * "send your email back" contract, which broke username logins and looked
 * users up across every school.
 *
 * Challenge tokens are signed with a key derived from JWT_ACCESS_SECRET but
 * different from it, so a challenge token can never pass `authenticate` as an
 * access token.
 */
export type AuthChallengePurpose = 'password_change';

interface AuthChallengePayload {
  sub: string;
  tid: string;
  purpose: AuthChallengePurpose;
  /** Fingerprint of the password hash at issue time: the token dies once the password changes. */
  pwf: string;
}

const CHALLENGE_TTL_SECONDS: Record<AuthChallengePurpose, number> = {
  password_change: 15 * 60,
};

function challengeSecret(): string {
  return crypto
    .createHmac('sha256', env.JWT_ACCESS_SECRET)
    .update('auth-challenge:v1')
    .digest('hex');
}

export function passwordFingerprint(passwordHash: string): string {
  return crypto.createHash('sha256').update(passwordHash).digest('hex').slice(0, 24);
}

export function issueAuthChallenge(
  user: { id: string; tenantId: string; passwordHash: string },
  purpose: AuthChallengePurpose
): string {
  const payload: AuthChallengePayload = {
    sub: user.id,
    tid: user.tenantId,
    purpose,
    pwf: passwordFingerprint(user.passwordHash),
  };
  return jwt.sign(payload, challengeSecret(), {
    expiresIn: CHALLENGE_TTL_SECONDS[purpose],
    audience: `auth-challenge:${purpose}`,
  });
}

export function readAuthChallenge(
  token: string,
  purpose: AuthChallengePurpose
): AuthChallengePayload {
  try {
    const decoded = jwt.verify(token, challengeSecret(), {
      audience: `auth-challenge:${purpose}`,
    }) as AuthChallengePayload;
    if (decoded.purpose !== purpose || !decoded.sub || !decoded.tid) {
      throw new Error('wrong purpose');
    }
    return decoded;
  } catch {
    throw new AppError(
      401,
      'AUTH_CHALLENGE_INVALID',
      'This sign-in step has expired. Please sign in again.'
    );
  }
}

/**
 * A starter credential is a password equal to the account's username or to the
 * student's code (how student accounts are provisioned). Such logins must set a
 * new password before they get a session.
 */
export function isStarterCredential(
  password: string,
  candidates: Array<string | null | undefined>
): boolean {
  const normalized = password.trim().toLowerCase();
  return candidates.some(value => Boolean(value) && value!.trim().toLowerCase() === normalized);
}

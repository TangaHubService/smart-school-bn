import crypto from 'crypto';
import { env } from '../../config/env';

export const generateOtp = (): string => {
  // secure random 6‑digit code
  const otp = crypto.randomInt(100000, 1000000).toString();
  return otp;
};

export const hashOtp = (otp: string): string => {
  // hash with SHA‑256 and secret
  return crypto.createHash('sha256').update(`${otp}:${env.OTP_HASH_SECRET}`).digest('hex');
};

export const verifyOtpHash = (otp: string, hash: string): boolean => {
  const actual = Buffer.from(hashOtp(otp), 'hex');
  const expected = Buffer.from(hash, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
};

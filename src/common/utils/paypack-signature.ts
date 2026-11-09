import crypto from 'crypto';

/**
 * Verifies a Paypack callback: `X-Paypack-Signature` must be the base64
 * HMAC-SHA256 of the raw request body with PAYPACK_WEBHOOK_SECRET.
 *
 * Fails closed: a missing secret, signature or raw body is a rejection.
 */
export function isValidPaypackSignature(
  secret: string | undefined,
  signature: string | undefined,
  rawBody: string | undefined
): boolean {
  if (!secret || !signature || !rawBody) {
    return false;
  }

  const expected = Buffer.from(
    crypto.createHmac('sha256', secret).update(rawBody).digest('base64')
  );
  const received = Buffer.from(signature);

  return expected.length === received.length && crypto.timingSafeEqual(expected, received);
}

import crypto from 'crypto';
import axios from 'axios';
import { env } from '../../config/env';

export interface PaypackToken {
  access?: string;
  refresh?: string;
  expires?: unknown;
  message?: string;
  error?: string;
}

export interface PaypackCashinResponse {
  ref: string;
  status: string;
  amount?: number;
  kind?: string;
  provider?: string | null;
  message?: string;
  createdAt?: string;
}

export class PaypackService {
  private static accessToken: string | null = null;
  private static refreshToken: string | null = null;
  private static accessTokenExpiresAtMs: number | null = null;
  private static apiBaseUrl = (env.PAYPACK_API_BASE_URL ?? env.PAYPACK_BASE_URL).replace(/\/+$/, '');
  private static webhookMode =
    (env.PAYPACK_WEBHOOK_MODE ??
      (env.NODE_ENV === 'production' ? 'production' : 'development')).toString();
  private static primaryInitiatePath = (env.PAYPACK_INITIATE_PATH ?? '/checkouts/initiate').toString();

  private static generateIdempotencyKey(): string {
    return crypto.randomBytes(16).toString('hex').slice(0, 32);
  }

  private static parseExpiresToMs(expiresRaw: unknown): number | null {
    if (expiresRaw == null) return null;

    const num = Number(expiresRaw);
    if (!Number.isFinite(num) || num <= 0) return null;

    if (num > 1e12) return num;
    if (num > 1e9) return num * 1000;
    return Date.now() + num * 1000;
  }

  private static isAccessTokenValid(): boolean {
    if (!this.accessToken) return false;
    if (!this.accessTokenExpiresAtMs) return true;
    return Date.now() + 30_000 < this.accessTokenExpiresAtMs;
  }

  private static normalizePhoneNumber(raw: string): string {
    const cleaned = raw.replace(/\s+/g, '').replace(/-/g, '');
    if (cleaned.startsWith('+2507') && cleaned.length === 13) return `0${cleaned.slice(4)}`;
    if (cleaned.startsWith('2507') && cleaned.length === 12) return `0${cleaned.slice(3)}`;
    return cleaned;
  }

  private static normalizeRef(payload: Record<string, unknown> | null): string | null {
    const nested = this.asRecord(payload?.data);
    const value =
      payload?.ref ??
      payload?.id ??
      payload?.checkout_id ??
      nested?.ref ??
      nested?.id;

    return typeof value === 'string' || typeof value === 'number' ? String(value) : null;
  }

  private static asRecord(value: unknown): Record<string, unknown> | null {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return null;
    }

    return value as Record<string, unknown>;
  }

  private static async getAccessToken(): Promise<string> {
    if (this.isAccessTokenValid()) {
      return this.accessToken as string;
    }

    const refreshed = await this.refreshAccessToken();
    if (refreshed && this.accessToken) {
      return this.accessToken;
    }

    await this.authorize();
    return this.accessToken as string;
  }

  private static async authorize(): Promise<void> {
    if (!env.PAYPACK_CLIENT_ID || !env.PAYPACK_CLIENT_SECRET) {
      throw new Error('Paypack credentials missing');
    }

    const response = await axios.post<PaypackToken>(
      `${this.apiBaseUrl}/auth/agents/authorize`,
      {
        client_id: env.PAYPACK_CLIENT_ID,
        client_secret: env.PAYPACK_CLIENT_SECRET,
      },
      {
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        validateStatus: () => true,
      },
    );

    const body = response.data;
    if (response.status < 200 || response.status >= 300) {
      throw new Error(body?.message || body?.error || `Paypack authorize failed (${response.status})`);
    }

    this.accessToken = body?.access ?? null;
    this.refreshToken = body?.refresh ?? null;
    this.accessTokenExpiresAtMs = this.parseExpiresToMs(body?.expires);

    if (!this.accessToken) {
      throw new Error('Paypack authorize response missing access token');
    }
  }

  private static async refreshAccessToken(): Promise<boolean> {
    if (!this.refreshToken) return false;

    const response = await axios.get<PaypackToken>(
      `${this.apiBaseUrl}/auth/agents/refresh/${this.refreshToken}`,
      {
        headers: { Accept: 'application/json' },
        validateStatus: () => true,
      },
    );

    if (response.status < 200 || response.status >= 300) {
      return false;
    }

    const body = response.data;
    this.accessToken = body?.access ?? null;
    this.refreshToken = body?.refresh ?? this.refreshToken;
    this.accessTokenExpiresAtMs = this.parseExpiresToMs(body?.expires);

    return Boolean(this.accessToken);
  }

  static async cashin(
    amount: number,
    phoneNumber: string,
    idempotencyKeyInput?: string,
  ): Promise<PaypackCashinResponse> {
    if (!phoneNumber) {
      throw new Error('phoneNumber is required');
    }

    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('amount must be greater than 0');
    }

    const token = await this.getAccessToken();
    const idempotencyKey = (idempotencyKeyInput ?? this.generateIdempotencyKey()).toString();
    if (idempotencyKey.length > 32) {
      throw new Error('Paypack Idempotency-Key must be maxLength 32');
    }

    const normalizedPhoneNumber = this.normalizePhoneNumber(phoneNumber);
    const pathCandidates = Array.from(
      new Set([this.primaryInitiatePath, '/transactions/cashin']),
    );

    let lastErrorMessage = 'Paypack cashin failed';

    for (const path of pathCandidates) {
      const normalizedPath = path.startsWith('/') ? path : `/${path}`;
      const response = await axios.post<Record<string, unknown>>(
        `${this.apiBaseUrl}${normalizedPath}`,
        {
          amount,
          number: normalizedPhoneNumber,
        },
        {
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
            Authorization: `Bearer ${token}`,
            'X-Webhook-Mode': this.webhookMode,
            'Idempotency-Key': idempotencyKey,
          },
          validateStatus: () => true,
        },
      );

      const body = this.asRecord(response.data);
      if (response.status >= 200 && response.status < 300) {
        const ref = this.normalizeRef(body);
        if (!ref) {
          throw new Error('Paypack response missing transaction reference');
        }

        const nested = this.asRecord(body?.data);
        const amountValue = body?.amount ?? body?.total ?? nested?.amount;
        const kindValue = body?.kind ?? body?.type ?? nested?.kind;
        const providerValue = body?.provider ?? body?.network ?? nested?.provider ?? null;
        const messageValue =
          body?.message ??
          body?.instruction ??
          body?.instructions ??
          body?.ussd ??
          nested?.message;
        const createdAtValue = body?.createdAt ?? body?.created_at ?? nested?.createdAt;

        return {
          ref,
          status:
            typeof (body?.status ?? body?.state ?? body?.payment_status) === 'string'
              ? String(body?.status ?? body?.state ?? body?.payment_status)
              : 'pending',
          amount: typeof amountValue === 'number' ? amountValue : Number(amountValue) || undefined,
          kind: typeof kindValue === 'string' ? kindValue : undefined,
          provider: typeof providerValue === 'string' ? providerValue : providerValue === null ? null : null,
          message: typeof messageValue === 'string' ? messageValue : undefined,
          createdAt: typeof createdAtValue === 'string' ? createdAtValue : undefined,
        };
      }

      lastErrorMessage =
        (typeof body?.message === 'string' && body.message) ||
        (typeof body?.error === 'string' && body.error) ||
        `Paypack cashin failed on ${normalizedPath} (${response.status})`;
    }

    throw new Error(lastErrorMessage);
  }
}

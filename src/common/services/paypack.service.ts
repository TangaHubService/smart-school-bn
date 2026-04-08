import axios from 'axios';
import { env } from '../../config/env';

export interface PaypackToken {
  access: string;
  refresh: string;
  expires: string;
}

export interface PaypackCashinResponse {
  ref: string;
  status: string;
  amount: number;
  kind: string;
  createdAt: string;
}

export class PaypackService {
  private static baseURL = env.PAYPACK_BASE_URL;
  private static webhookMode = env.PAYPACK_WEBHOOK_MODE;

  private static async getAccessToken(): Promise<string> {
    if (!env.PAYPACK_CLIENT_ID || !env.PAYPACK_CLIENT_SECRET) {
      throw new Error('Paypack credentials missing');
    }

    const { data } = await axios.post<PaypackToken>(
      `${this.baseURL}/auth/agents/authorize`,
      {
        client_id: env.PAYPACK_CLIENT_ID,
        client_secret: env.PAYPACK_CLIENT_SECRET,
      },
      { headers: { 'Content-Type': 'application/json', Accept: 'application/json' } }
    );
    return data.access;
  }

  static async cashin(amount: number, phoneNumber: string): Promise<PaypackCashinResponse> {
    const token = await this.getAccessToken();
    const { data } = await axios.post<PaypackCashinResponse>(
      `${this.baseURL}/transactions/cashin`,
      {
        amount,
        number: phoneNumber,
      },
      {
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
          Authorization: `Bearer ${token}`,
          'X-Webhook-Mode': this.webhookMode,
        },
      }
    );
    return data;
  }
}

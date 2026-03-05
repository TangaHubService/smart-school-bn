import { NextFunction } from 'express';

import { errorHandlerMiddleware } from '../../src/common/middleware/error-handler.middleware';

export interface MockRequest {
  requestId: string;
  body: unknown;
  ip?: string;
  user?: unknown;
  tenantId?: string;
  headers: Record<string, string | undefined>;
  header: (name: string) => string | undefined;
}

export interface MockResponse {
  statusCode: number;
  payload: unknown;
  headers: Record<string, string>;
  status: (code: number) => MockResponse;
  json: (payload: unknown) => MockResponse;
  setHeader: (name: string, value: string) => void;
}

export function createMockRequest(overrides: Partial<MockRequest> = {}): MockRequest {
  const headers = overrides.headers ?? {};
  return {
    requestId: overrides.requestId ?? 'req-test-1',
    body: overrides.body ?? {},
    ip: overrides.ip ?? '127.0.0.1',
    user: overrides.user,
    tenantId: overrides.tenantId,
    headers,
    header: (name: string) => headers[name.toLowerCase()],
  };
}

export function createMockResponse(): MockResponse {
  const response: MockResponse = {
    statusCode: 200,
    payload: null,
    headers: {},
    status(code: number) {
      response.statusCode = code;
      return response;
    },
    json(payload: unknown) {
      response.payload = payload;
      return response;
    },
    setHeader(name: string, value: string) {
      response.headers[name.toLowerCase()] = value;
    },
  };

  return response;
}

export function runMiddleware(
  middleware: (req: any, res: any, next: NextFunction) => void,
  req: MockRequest,
  res: MockResponse,
): Promise<void> {
  return new Promise((resolve, reject) => {
    middleware(req as any, res as any, (error?: unknown) => {
      if (error) {
        reject(error);
        return;
      }
      resolve();
    });
  });
}

export function applyError(
  error: unknown,
  req: MockRequest,
  res: MockResponse,
): void {
  errorHandlerMiddleware(error, req as any, res as any, (() => undefined) as NextFunction);
}

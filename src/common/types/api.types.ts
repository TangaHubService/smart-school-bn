export interface PaginationMeta {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface ApiMeta {
  requestId: string;
  timestamp: string;
  pagination: PaginationMeta | null;
  academyCatalog?: {
    resolved: boolean;
    publicProgramCount: number;
  };
}

export interface ApiError {
  code: string;
  message: string;
  details: unknown;
}

export interface ApiEnvelope<T> {
  data: T | null;
  error: ApiError | null;
  meta: ApiMeta;
}

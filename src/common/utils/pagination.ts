import { PaginationMeta } from '../types/api.types';

export function buildPagination(
  page: number,
  pageSize: number,
  totalItems: number,
): PaginationMeta {
  return {
    page,
    pageSize,
    totalItems,
    totalPages: Math.max(1, Math.ceil(totalItems / pageSize)),
  };
}

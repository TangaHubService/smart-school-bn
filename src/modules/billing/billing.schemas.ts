import { z } from 'zod';

export const paySubscriptionInvoiceSchema = z.object({
  phoneNumber: z
    .string()
    .trim()
    .regex(
      /^(?:\+?250|0)7\d{8}$/,
      'Enter a valid Rwandan Mobile Money number (e.g. 0788123456)'
    ),
});

export type PaySubscriptionInvoiceInput = z.infer<typeof paySubscriptionInvoiceSchema>;

/** Manual school billing (Rev #16–19): not every school uses online payment. */
export const SUPPORTED_CURRENCIES = ['RWF', 'USD', 'EUR', 'KES', 'UGX', 'TZS'] as const;
export const SUPPORTED_PAYMENT_METHODS = [
  'CASH',
  'BANK',
  'MOBILE_MONEY',
  'CARD',
  'OTHER',
] as const;

export const createManualInvoiceSchema = z.object({
  tenantId: z.string().uuid(),
  title: z.string().trim().min(2).max(200),
  description: z.string().trim().min(2).max(2000),
  amountDue: z.number().positive().max(1_000_000_000),
  currency: z.enum(SUPPORTED_CURRENCIES).default('RWF'),
  paymentMethod: z.enum(SUPPORTED_PAYMENT_METHODS).optional(),
  paymentDate: z.string().optional(),
  periodStart: z.string(),
  periodEnd: z.string(),
  dueDate: z.string().optional(),
  status: z.enum(['PENDING', 'PAID', 'VOID']).default('PENDING'),
  reference: z.string().trim().max(120).optional(),
  notes: z.string().trim().max(2000).optional(),
});

export const recordManualPaymentSchema = z.object({
  amount: z.number().positive().max(1_000_000_000),
  currency: z.enum(SUPPORTED_CURRENCIES).default('RWF'),
  paymentMethod: z.enum(SUPPORTED_PAYMENT_METHODS).default('CASH'),
  reference: z.string().trim().max(120).optional(),
  paymentDate: z.string().optional(),
});

export type CreateManualInvoiceInput = z.infer<typeof createManualInvoiceSchema>;
export type RecordManualPaymentInput = z.infer<typeof recordManualPaymentSchema>;

export const listInvoicesQuerySchema = z.object({
  tenantId: z.string().uuid().optional(),
  status: z.enum(['PENDING', 'PAID', 'VOID']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type ListInvoicesQueryInput = z.infer<typeof listInvoicesQuerySchema>;

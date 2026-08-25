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

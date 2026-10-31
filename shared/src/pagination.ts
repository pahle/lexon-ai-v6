import { z } from 'zod';
import { UuidSchema } from './identity.js';

export const PaginationSchema = z.strictObject({
  limit: z.number().int().min(1).max(100).default(20),
  cursor: UuidSchema.optional(),
});
export const PageInfoSchema = z.strictObject({
  nextCursor: UuidSchema.nullable(),
});

export type Pagination = z.infer<typeof PaginationSchema>;
export type PageInfo = z.infer<typeof PageInfoSchema>;

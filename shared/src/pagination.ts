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
export interface Page<T> {
  items: T[];
  pageInfo: PageInfo;
}
export const pageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({ items: z.array(item), pageInfo: PageInfoSchema });

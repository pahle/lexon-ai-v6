import { z } from 'zod';

export const PageSizeSchema = z.union([
  z.literal(10),
  z.literal(20),
  z.literal(50),
]);
export const NumberedPageQuerySchema = z.strictObject({
  page: z.coerce.number().int().min(1).max(10_000).default(1),
  pageSize: z.coerce.number().pipe(PageSizeSchema).default(20),
});
export const numberedPageSchema = <T extends z.ZodType>(item: T) =>
  z.strictObject({
    items: z.array(item),
    page: z.number().int().min(1),
    pageSize: PageSizeSchema,
    total: z.number().int().nonnegative(),
  });
// Repeated facet parameter: ?status=active&status=disabled, or a single value.
export const facetSchema = <T extends z.ZodEnum>(values: T) =>
  z.preprocess(
    (v) => (v === undefined ? undefined : [...new Set([v].flat())]),
    z.array(values).min(1).max(values.options.length).optional(),
  );
export type PageSize = z.infer<typeof PageSizeSchema>;
export type NumberedPageQuery = z.infer<typeof NumberedPageQuerySchema>;

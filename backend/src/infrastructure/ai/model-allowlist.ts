import { z } from 'zod';
const model = z.strictObject({
  id: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  region: z.string().trim().min(1),
  zeroDataRetention: z.literal(true),
  reviewedAt: z.iso.datetime(),
});
export const ModelAllowlistSchema = z
  .strictObject({ version: z.literal(1), models: z.array(model) })
  .superRefine((config, context) => {
    const pairs = new Set<string>();
    for (const [index, entry] of config.models.entries()) {
      const key = JSON.stringify([entry.id, entry.provider]);
      if (pairs.has(key))
        context.addIssue({
          code: 'custom',
          path: ['models', index],
          message: 'Duplicate model-provider pair',
        });
      pairs.add(key);
    }
  });

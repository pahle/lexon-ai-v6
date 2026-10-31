import { z } from 'zod';

const schema = z.strictObject({
  outboxId: z.uuid(),
  type: z.literal('platform.noop.v1'),
  ctx: z.strictObject({ orgId: z.uuid(), userId: z.uuid().optional() }),
  payload: z.strictObject({ probeId: z.uuid() }),
});
export type JobEnvelope = Readonly<{
  outboxId: string;
  type: 'platform.noop.v1';
  ctx: Readonly<{ orgId: string; userId?: string }>;
  payload: Readonly<{ probeId: string }>;
}>;

export function parseJobEnvelope(input: unknown): JobEnvelope {
  const result = schema.safeParse(input);
  // Zod issues can contain input values. Never expose them for queue metadata.
  if (!result.success) throw new Error('Invalid job envelope');
  const { outboxId, type, ctx, payload } = result.data;
  return Object.freeze({
    outboxId,
    type,
    ctx: Object.freeze({
      orgId: ctx.orgId,
      ...(ctx.userId === undefined ? {} : { userId: ctx.userId }),
    }),
    payload: Object.freeze(payload),
  });
}

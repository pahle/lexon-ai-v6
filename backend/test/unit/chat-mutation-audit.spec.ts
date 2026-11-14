import { randomUUID } from 'node:crypto';
import { expect, test } from 'vitest';
import { AuditEventSchema } from '../../src/modules/audit/index.js';

const event = (
  type:
    | 'chat.renamed.v1'
    | 'chat.message_edited.v1'
    | 'chat.message_regenerated.v1',
  metadata: Record<string, string>,
) => ({
  version: 1,
  eventId: randomUUID(),
  type,
  occurredAt: new Date().toISOString(),
  outcome: 'success',
  actorUserId: randomUUID(),
  orgId: randomUUID(),
  metadata,
});

test.each([
  {
    name: 'rename',
    type: 'chat.renamed.v1' as const,
    metadata: () => ({ chatId: randomUUID() }),
    content: { title: 'Private title' },
  },
  {
    name: 'edit',
    type: 'chat.message_edited.v1' as const,
    metadata: () => ({ chatId: randomUUID(), messageId: randomUUID() }),
    content: { text: 'Private prompt' },
  },
  {
    name: 'regenerate',
    type: 'chat.message_regenerated.v1' as const,
    metadata: () => ({ chatId: randomUUID(), messageId: randomUUID() }),
    content: { prompt: 'Private prompt' },
  },
])(
  'the $name audit contract accepts UUID IDs and rejects content',
  ({ type, metadata, content }) => {
    const valid = event(type, metadata());
    expect(AuditEventSchema.safeParse(valid).success).toBe(true);
    expect(
      AuditEventSchema.safeParse({
        ...valid,
        metadata: { ...valid.metadata, ...content },
      }).success,
    ).toBe(false);
    const malformed = Object.fromEntries(
      Object.keys(valid.metadata).map((key) => [key, 'not-a-uuid']),
    );
    expect(
      AuditEventSchema.safeParse({ ...valid, metadata: malformed }).success,
    ).toBe(false);
  },
);

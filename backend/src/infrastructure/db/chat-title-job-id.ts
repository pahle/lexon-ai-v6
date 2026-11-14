import { createHash } from 'node:crypto';
import { z } from 'zod';

const uuid = z.uuid();
const namespace = Buffer.from('d4d8a72b3bb64fb9a0f25172e805cf18', 'hex');

/** Stable outbox identity for the one title task owned by a chat. */
export function chatTitleJobId(chatId: string): string {
  if (!uuid.safeParse(chatId).success)
    throw new Error('Invalid title job identity');
  const digest = createHash('sha1')
    .update(namespace)
    .update(`lexon/chat-title/${chatId.toLowerCase()}`)
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

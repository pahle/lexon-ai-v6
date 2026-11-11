import { createHash } from 'node:crypto';

export type ChatCleanupPhase = 'grace' | 'purge_db' | 'purge_valkey';

const NAMESPACE = Buffer.from('9f4b59ad7d8f5b049718924b50a90f13', 'hex');

export function chatCleanupJobId(
  chatId: string,
  phase: ChatCleanupPhase,
): string {
  const hash = createHash('sha1')
    .update(NAMESPACE)
    .update(`${chatId}:${phase}`)
    .digest();
  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

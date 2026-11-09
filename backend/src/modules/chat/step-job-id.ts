import { createHash } from 'node:crypto';
import { z } from 'zod';

const uuidPattern = z.uuid();
const dnsNamespace = Buffer.from('6ba7b8109dad11d180b400c04fd430c8', 'hex');

/** Stable UUID v5 used as the outbox and BullMQ identity for one AI step. */
export function stepJobId(runId: string, sequence: number): string {
  if (
    !uuidPattern.safeParse(runId).success ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1
  )
    throw new Error('Invalid step job identity');

  const name = Buffer.from(`lexon/run/${runId.toLowerCase()}/step/${sequence}`);
  const digest = createHash('sha1')
    .update(dnsNamespace)
    .update(name)
    .digest()
    .subarray(0, 16);
  digest[6] = (digest[6]! & 0x0f) | 0x50;
  digest[8] = (digest[8]! & 0x3f) | 0x80;
  const hex = digest.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

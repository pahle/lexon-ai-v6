import { createHmac } from 'node:crypto';

// Test oracle only. Runtime authentication always uses Better Auth.
export function totp(
  secret: Buffer,
  now: number,
  digits = 6,
  period = 30,
): string {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(now / 1000 / period)));
  const digest = createHmac('sha1', secret).update(counter).digest();
  const offset = digest.at(-1)! & 15;
  return String(
    (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** digits,
  ).padStart(digits, '0');
}
export function totpForUri(uri: string, now = Date.now()): string {
  const url = new URL(uri);
  const encoded = url.searchParams.get('secret')!;
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
  let bits = 0;
  let value = 0;
  const bytes: number[] = [];
  for (const char of encoded.toUpperCase().replace(/=+$/, '')) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error('Invalid test TOTP secret');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes.push((value >>> bits) & 255);
    }
  }
  return totp(
    Buffer.from(bytes),
    now,
    Number(url.searchParams.get('digits') ?? 6),
    Number(url.searchParams.get('period') ?? 30),
  );
}

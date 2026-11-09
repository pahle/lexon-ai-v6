import { randomBytes } from 'node:crypto';

export function fenceUntrusted(text: string, label: string): string {
  if (typeof text !== 'string' || typeof label !== 'string')
    throw new TypeError('Untrusted context must be text with a text label');

  let nonce: string;
  do {
    nonce = randomBytes(16).toString('hex');
  } while (text.includes(nonce) || label.includes(nonce));

  return [
    `BEGIN UNTRUSTED CONTEXT nonce="${nonce}" label=${JSON.stringify(label)}`,
    text,
    `END UNTRUSTED CONTEXT nonce="${nonce}"`,
  ].join('\n');
}

import { BlockList, isIP } from 'node:net';
import { validateTrustedProxies } from '../../config/auth-rate-config.js';

function normalize(address: string): string {
  const family = isIP(address);
  if (!family) throw new Error('Invalid client address');
  if (family === 4) return address;
  const canonical = new URL(`http://[${address}]`).hostname.slice(1, -1);
  const mapped = canonical.match(/^::ffff:([a-f0-9]{1,4}):([a-f0-9]{1,4})$/i);
  if (!mapped) return canonical;
  const high = parseInt(mapped[1]!, 16),
    low = parseInt(mapped[2]!, 16);
  return [high >> 8, high & 255, low >> 8, low & 255].join('.');
}
export function resolveClientAddress(
  peer: string,
  headers: Headers,
  trustedProxies: readonly string[],
): string {
  const trusted = new BlockList();
  for (const value of validateTrustedProxies(trustedProxies)) {
    const [address, prefix] = value.split('/');
    const family = isIP(address!) === 4 ? 'ipv4' : 'ipv6';
    if (prefix === undefined) trusted.addAddress(address!, family);
    else trusted.addSubnet(address!, Number(prefix), family);
  }
  const allowed = (address: string) =>
    trusted.check(address, isIP(address) === 4 ? 'ipv4' : 'ipv6');
  let current = normalize(peer);
  if (!allowed(current)) return current;
  const raw = headers.get('x-forwarded-for');
  if (raw === null) return current;
  const chain = raw.split(',').map((value) => normalize(value.trim()));
  for (let index = chain.length - 1; index >= 0 && allowed(current); index--)
    current = chain[index]!;
  return current;
}

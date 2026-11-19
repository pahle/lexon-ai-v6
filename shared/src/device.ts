export type DeviceKind = 'desktop' | 'mobile' | 'tablet' | 'unknown';
export interface DeviceDescription {
  /** "Chrome on macOS"; "Unknown device" when nothing is recognised. */
  name: string;
  kind: DeviceKind;
}

// Browsers are matched most specific first: Chromium derivatives also say
// "Chrome" and "Safari", and Chrome also says "Safari".
const BROWSERS: readonly (readonly [RegExp, string])[] = [
  [/\bEdg(?:e|A|iOS)?\//, 'Edge'],
  [/\b(?:OPR|OPiOS)\/|\bOpera\b/, 'Opera'],
  [/\bSamsungBrowser\//, 'Samsung Internet'],
  [/\b(?:Firefox|FxiOS)\//, 'Firefox'],
  [/\b(?:Chrome|CriOS)\//, 'Chrome'],
  [/\bVersion\/[\d.]+.*\bSafari\//, 'Safari'],
];
// iPhone/iPad UAs say "Mac OS X" and Android UAs say "Linux", so those go first.
const SYSTEMS: readonly (readonly [RegExp, string])[] = [
  [/\biPhone\b/, 'iPhone'],
  [/\biPad\b/, 'iPad'],
  [/\bAndroid\b/, 'Android'],
  [/\bWindows\b/, 'Windows'],
  [/\bCrOS\b/, 'ChromeOS'],
  [/\bMac OS X\b|\bMacintosh\b/, 'macOS'],
  [/\bLinux\b|\bX11\b/, 'Linux'],
];
const MAX_USER_AGENT_LENGTH = 1024;

/** Names the browser and system in a stored user agent. Pure, no raw value is returned. */
export function describeDevice(
  userAgent: string | null | undefined,
): DeviceDescription {
  const ua = (userAgent ?? '').trim();
  if (!ua || ua.length > MAX_USER_AGENT_LENGTH)
    return { name: 'Unknown device', kind: 'unknown' };
  const browser = BROWSERS.find(([pattern]) => pattern.test(ua))?.[1];
  const system = SYSTEMS.find(([pattern]) => pattern.test(ua))?.[1];
  if (!browser && !system) return { name: 'Unknown device', kind: 'unknown' };
  const name =
    browser && system ? `${browser} on ${system}` : (browser ?? system)!;
  let kind: DeviceKind = 'desktop';
  if (system === 'iPhone') kind = 'mobile';
  else if (system === 'iPad') kind = 'tablet';
  else if (system === 'Android')
    kind = /\bMobile\b/.test(ua) ? 'mobile' : 'tablet';
  else if (!system) kind = 'unknown';
  return { name, kind };
}

// The prototype's Security state: three sessions (this device, an iPhone, a
// Windows PC), a password changed two months ago, and two-step verification
// with eight recovery codes left. The GET responses are rewritten the way the
// other visual normalizations are, so the capture needs no sign-ins from other
// devices and no clock-dependent database edits. Location is not part of the
// data (owner decision pending).
import type { Page, Route } from '@playwright/test';
import { brandFixedTime } from './brand-visual-support.js';

const day = 24 * 60 * 60 * 1000;
const iso = (offsetDays: number) =>
  new Date(new Date(brandFixedTime).getTime() + offsetDays * day).toISOString();

export async function installPrototypeSecurity(page: Page) {
  const pending = new Set<Promise<void>>();
  const track = (work: Promise<void>) => {
    pending.add(work);
    void work.then(
      () => pending.delete(work),
      () => pending.delete(work),
    );
    return work;
  };
  const sessions = (url: URL) =>
    url.pathname === '/api/identity/sessions' && url.search === '';
  const security = (url: URL) => url.pathname === '/api/identity/security';
  const sessionsHandler = (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return track(
      (async () => {
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        const rows = (await response.json()) as Array<Record<string, unknown>>;
        const current = rows.find((row) => row.current) ?? rows[0]!;
        const base = { ...current, channel: 'cookie', expiresAt: iso(30) };
        return route.fulfill({
          response,
          json: [
            {
              ...base,
              createdAt: iso(-0.01),
              current: true,
              deviceName: 'Chrome on macOS',
              deviceKind: 'desktop',
            },
            {
              ...base,
              id: '00000000-0000-4000-8000-0000000005a1',
              createdAt: iso(-3),
              current: false,
              deviceName: 'Safari on iPhone',
              deviceKind: 'mobile',
            },
            {
              ...base,
              id: '00000000-0000-4000-8000-0000000005a2',
              createdAt: iso(-9),
              current: false,
              deviceName: 'Edge on Windows',
              deviceKind: 'desktop',
            },
          ],
        });
      })(),
    );
  };
  const securityHandler = (route: Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    return track(
      (async () => {
        const response = await route.fetch();
        if (!response.ok()) return route.fulfill({ response });
        const state = (await response.json()) as Record<string, unknown>;
        return route.fulfill({
          response,
          json: {
            ...state,
            twoFactorEnabled: true,
            mfaVerified: true,
            recoveryCodesRemaining: 8,
            passwordChangedAt: iso(-61),
          },
        });
      })(),
    );
  };
  await page.route(sessions, sessionsHandler);
  await page.route(security, securityHandler);
  return {
    async remove() {
      await page.unroute(sessions, sessionsHandler);
      await page.unroute(security, securityHandler);
      await Promise.all([...pending]);
    },
  };
}

import type { Locator, Page } from '@playwright/test';
import { expect, test } from '@playwright/test';
import { orderExactCaptureRows } from '../../../scripts/test/visual-capture-normalizations.mjs';

export type VisualTheme = 'light' | 'dark';
export type VisualViewport = 'desktop' | 'mobile';
export type ReviewWidth = 390 | 768 | 1440;
export type CheckpointCView =
  | 'sign-in'
  | 'sign-in-field-errors'
  | 'sign-in-password-shown-loading'
  | 'sign-in-form-error'
  | 'home'
  | 'sidebar-collapsed'
  | 'organization-switcher-open'
  | 'user-menu-open'
  | 'profile'
  | 'appearance'
  | 'security'
  | 'members'
  | 'invitations'
  | 'general'
  | 'settings-saved-toast';
export type ShellReviewView =
  | 'home'
  | 'sidebar-expanded'
  | 'organization-switcher-open'
  | 'user-menu-open'
  | 'sidebar-collapsed';

async function ensureMobileSidebarOpen(page: Page) {
  const sidebarDialog = page.getByRole('dialog', { name: 'Sidebar' });
  const openNavigation = page.getByRole('button', {
    name: 'Open navigation',
  });
  await expect
    .poll(
      async () =>
        (await sidebarDialog.isVisible()) || (await openNavigation.isVisible()),
    )
    .toBe(true);
  if (!(await sidebarDialog.isVisible())) {
    await expect(openNavigation).toBeVisible();
    await openNavigation.click();
  }
  await expect(sidebarDialog).toBeVisible();
}

const sizes = {
  desktop: { width: 1440, height: 900 },
  mobile: { width: 390, height: 844 },
} as const;

export async function captureTask7BViewportReview(
  page: Page,
  view: string,
  width: ReviewWidth,
  theme: VisualTheme,
) {
  const height = width === 390 ? 844 : width === 768 ? 720 : 900;
  await page.setViewportSize({ width, height });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate((value) => {
    localStorage.setItem('theme', value);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: value,
        storageArea: localStorage,
      }),
    );
  }, theme);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('html')).toHaveClass(
    theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
  if (view === 'appearance') {
    await expect(
      page.getByRole('radio', {
        name: theme === 'dark' ? 'Dark' : 'Light',
        exact: true,
      }),
    ).toBeChecked();
  }
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts).some(
          (font) => font.status === 'loaded' && /inter/i.test(font.family),
        );
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  const documentWidth = await page
    .locator('html')
    .evaluate((node) => node.scrollWidth);
  const overflowNodes =
    documentWidth > width
      ? await page.evaluate(() =>
          Array.from(document.body.querySelectorAll('*'))
            .map((element) => {
              const rect = element.getBoundingClientRect();
              const style = getComputedStyle(element);
              return {
                tag: element.tagName.toLowerCase(),
                slot: element.getAttribute('data-slot'),
                className:
                  typeof element.className === 'string'
                    ? element.className
                    : '',
                left: Math.round(rect.left),
                right: Math.round(rect.right),
                width: Math.round(rect.width),
                scrollWidth: element.scrollWidth,
                clientWidth: element.clientWidth,
                overflowX: style.overflowX,
              };
            })
            .filter(
              (element) =>
                element.right > window.innerWidth + 1 &&
                element.overflowX === 'visible',
            )
            .sort((left, right) => right.right - left.right)
            .slice(0, 8),
        )
      : [];
  expect(documentWidth, JSON.stringify(overflowNodes)).toBeLessThanOrEqual(
    width,
  );
  await page.mouse.move(0, 0);
}

/**
 * Switches the theme the way another tab would (localStorage plus a storage
 * event) and waits for the document to follow. next-themes attaches its
 * storage listener in an effect after its first client render, so an event
 * dispatched in that gap right after a navigation is lost and the page keeps
 * the previous theme. Setting and dispatching again is idempotent, so the
 * switch is repeated until the document class matches, within the normal
 * expect timeout.
 */
export async function applyTheme(page: Page, theme: VisualTheme) {
  await expect(async () => {
    await page.evaluate((value) => {
      localStorage.setItem('theme', value);
      window.dispatchEvent(
        new StorageEvent('storage', {
          key: 'theme',
          newValue: value,
          storageArea: localStorage,
        }),
      );
    }, theme);
    await expect(page.locator('html')).toHaveClass(
      theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
      { timeout: 1000 },
    );
  }).toPass({ timeout: 10000 });
}

export async function captureCheckpointCView(
  page: Page,
  view: CheckpointCView,
  theme: VisualTheme,
) {
  await page.setViewportSize(sizes.desktop);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await expect(page.locator('main')).toHaveCount(1);
  await applyTheme(page, theme);
  if (view === 'appearance') {
    await expect(
      page.getByRole('radio', {
        name: theme === 'dark' ? 'Dark' : 'Light',
        exact: true,
      }),
    ).toBeChecked();
  }
  expect(
    await page.evaluate(() => ({
      width: window.innerWidth,
      height: window.innerHeight,
      deviceScaleFactor: window.devicePixelRatio,
    })),
  ).toEqual({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts).some(
          (font) => font.status === 'loaded' && /inter/i.test(font.family),
        );
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  await page.mouse.move(0, 0);
  const overlayText = await page
    .locator('nextjs-portal')
    .evaluateAll((elements) =>
      elements
        .map((element) => element.shadowRoot?.textContent ?? '')
        .join('\n'),
    );
  expect(overlayText).not.toMatch(
    /Build Error|Runtime Error|Unhandled Runtime Error/,
  );
}

export async function waitForVisualAuthFormReady(page: Page) {
  if (process.env.LEXON_VISUAL_DEV !== '1') return;
  await expect(page.locator('html')).toHaveAttribute(
    'data-lexon-visual-auth-ready',
    'true',
  );
}

/**
 * Opens a menu whose trigger may be clicked before the page has settled
 * (theme switch, hydration). Retries the click until aria-expanded is true,
 * never clicking an already-expanded trigger (that would close it), then
 * re-asserts after the open that the menu did not close by itself.
 */
export async function openMenuReliably(
  page: Page,
  trigger: Locator,
  opened: Locator,
  label: string,
) {
  let attempts = 0;
  await expect(async () => {
    attempts += 1;
    if ((await trigger.getAttribute('aria-expanded')) !== 'true') {
      await trigger.click();
    }
    await expect(trigger).toHaveAttribute('aria-expanded', 'true', {
      timeout: 1000,
    });
  }).toPass({ timeout: 10000 });
  await expect(opened).toBeVisible();
  // Re-assert after the open settles: a menu that opens and then closes by
  // itself must fail here instead of in a later capture step.
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => done(true))),
  );
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(opened).toBeVisible();
  const description = `${label} opened after ${attempts} click attempt(s)`;
  try {
    test.info().annotations.push({
      type: 'menu-open-attempts',
      description,
    });
  } catch {
    // Not inside a running test.
  }
  console.log(`[visual] ${description}`);
}

export async function captureShellReviewView(
  page: Page,
  view: ShellReviewView,
  theme: VisualTheme,
  viewport: VisualViewport,
  expectedHeading = 'Good morning, Checkpoint',
  expandPlatform = false,
) {
  await page.setViewportSize(sizes[viewport]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  const response = await page.reload();
  expect(response?.status()).toBe(200);
  await expect(
    page.getByRole('heading', { name: expectedHeading }),
  ).toBeAttached();
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('html')).toHaveClass(
    theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts).some(
          (font) => font.status === 'loaded' && /inter/i.test(font.family),
        );
      }),
    )
    .toBe(true);
  await page.evaluate(async () => {
    await Promise.all(Array.from(document.images, (image) => image.decode()));
  });
  if (viewport === 'mobile' && view !== 'home') {
    await page.getByRole('button', { name: 'Open navigation' }).click();
    await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
  }
  if (
    viewport === 'desktop' &&
    view !== 'sidebar-collapsed' &&
    (await page.getByRole('button', { name: 'Expand sidebar' }).isVisible())
  ) {
    await page.getByRole('button', { name: 'Expand sidebar' }).click();
  }
  if (expandPlatform) {
    await page
      .getByRole('button', { name: 'Toggle Platform navigation' })
      .click();
    await expect(
      page
        .getByRole('navigation', { name: 'Primary navigation' })
        .getByRole('link', { name: 'Provisioning', exact: true }),
    ).toBeVisible();
  }
  if (view === 'organization-switcher-open') {
    await page
      .getByRole('button', { name: 'Organization: Task 6A Team' })
      .click();
    await expect(page.getByTestId('organization-popup')).toBeVisible();
    await expect(
      page.getByRole('menuitem', { name: 'Personal' }),
    ).toBeVisible();
  } else if (view === 'user-menu-open') {
    await page
      .locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]')
      .click();
    await expect(
      page.getByRole('menuitem', { name: 'Sign out' }),
    ).toBeVisible();
  } else if (view === 'sidebar-collapsed') {
    const expand = page.getByRole('button', { name: 'Expand sidebar' });
    if (await expand.isVisible()) await expand.click();
    await expect(
      page.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'Collapse sidebar' }).click();
    await expect(
      page.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeVisible();
  }
  await page.mouse.move(0, 0);
}

export async function installTask9MemberOrderNormalization(
  page: Page,
  activeTeamId: string,
  emails: readonly string[],
) {
  const orderedEmails = [...emails];
  const pending = new Set<Promise<void>>();
  const memberUrl = (url: URL) =>
    url.pathname === `/api/organizations/${activeTeamId}/members`;
  const memberHandler = (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const handler = (async () => {
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const body = (await response.json()) as {
        items: Array<{ email: string }>;
        [key: string]: unknown;
      };
      await route.fulfill({
        response,
        json: orderExactCaptureRows(body, orderedEmails, 'Member'),
      });
    })();
    pending.add(handler);
    void handler.then(
      () => pending.delete(handler),
      () => pending.delete(handler),
    );
    return handler;
  };
  await page.route(memberUrl, memberHandler);
  return {
    async remove() {
      await page.unroute(memberUrl, memberHandler);
      await Promise.all([...pending]);
    },
  };
}

export async function captureTask9ReviewView(
  page: Page,
  view: string,
  theme: VisualTheme,
  viewport: VisualViewport,
  expectedIdentity: string,
  options: { loadedContent?: Locator; loadedContentTimeoutMs?: number } = {},
) {
  const size = sizes[viewport];
  await page.setViewportSize(size);
  await page.emulateMedia({ reducedMotion: 'reduce', colorScheme: theme });
  await page.evaluate((value) => {
    localStorage.setItem('theme', value);
    window.dispatchEvent(
      new StorageEvent('storage', {
        key: 'theme',
        newValue: value,
        storageArea: localStorage,
      }),
    );
  }, theme);
  await expect(page.locator('main')).toHaveCount(1);
  await expect(page.locator('html')).toHaveClass(
    theme === 'dark' ? /\bdark\b/ : /^(?!.*\bdark\b)/,
  );
  if (view === 'sidebar-header-expanded' && viewport === 'mobile') {
    await ensureMobileSidebarOpen(page);
  }
  if (view === 'sidebar-header-expanded' && viewport === 'desktop') {
    const expand = page.getByRole('button', { name: 'Expand sidebar' });
    if (await expand.isVisible()) await expand.click();
    await expect(
      page.getByRole('button', { name: 'Collapse sidebar' }),
    ).toBeVisible();
  }
  if (view === 'sidebar-header-collapsed-desktop') {
    const collapse = page.getByRole('button', { name: 'Collapse sidebar' });
    if (await collapse.isVisible()) await collapse.click();
    await expect(
      page.getByRole('button', { name: 'Expand sidebar' }),
    ).toBeVisible();
  }
  if (view === 'organization-switcher-open' || view === 'user-menu-open') {
    if (viewport === 'mobile') {
      await ensureMobileSidebarOpen(page);
    }
    const popup = page.getByTestId(
      view === 'organization-switcher-open'
        ? 'organization-popup'
        : 'user-menu-popup',
    );
    // Never rely on a menu left open by an earlier call: it can close after
    // the visibility check (theme switch, re-render). Close it, then reopen.
    if (await popup.isVisible().catch(() => false)) {
      await page.keyboard.press('Escape');
      await expect(popup).toBeHidden();
    }
    const trigger =
      view === 'organization-switcher-open'
        ? page.locator(
            '[data-slot="sidebar-header"] button[aria-haspopup="menu"]',
          )
        : page.locator(
            '[data-slot="sidebar-footer"] button[aria-haspopup="menu"]',
          );
    await openMenuReliably(
      page,
      trigger,
      view === 'organization-switcher-open'
        ? page.getByTestId('organization-popup')
        : page.getByRole('menuitem', { name: 'Sign out' }),
      view,
    );
  }
  await expect(
    page
      .getByText(expectedIdentity, { exact: true })
      .filter({ visible: true })
      .first(),
  ).toBeVisible();
  if (options.loadedContent) {
    await expect(options.loadedContent).toBeVisible(
      options.loadedContentTimeoutMs === undefined
        ? undefined
        : { timeout: options.loadedContentTimeoutMs },
    );
  }
  expect(
    await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      deviceScaleFactor: devicePixelRatio,
    })),
  ).toEqual({ ...size, deviceScaleFactor: 1 });
  expect(
    await page.evaluate(() => ({
      locale: navigator.language,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    })),
  ).toEqual({ locale: 'en-US', timezone: 'Asia/Jakarta' });
  await expect
    .poll(() =>
      page.evaluate(async () => {
        await document.fonts.ready;
        return Array.from(document.fonts).some(
          (font) => font.status === 'loaded' && /inter/i.test(font.family),
        );
      }),
    )
    .toBe(true);
  await page.evaluate(async () =>
    Promise.all(Array.from(document.images, (image) => image.decode())),
  );
  expect(
    await page
      .locator('img:visible')
      .evaluateAll((images) =>
        images.every(
          (image) =>
            (image as HTMLImageElement).naturalWidth > 0 &&
            (image as HTMLImageElement).naturalHeight > 0,
        ),
      ),
  ).toBe(true);
  await page.mouse.move(0, 0);
  if (view === 'sidebar-header-expanded' && viewport === 'mobile') {
    const organizationTrigger = page.locator(
      '[data-slot="sidebar-header"] button[aria-haspopup="menu"]',
    );
    // The sheet moves initial focus inside on a later animation frame; blur
    // only after that has happened so it cannot land after the blur.
    await expect
      .poll(() =>
        page
          .getByRole('dialog', { name: 'Sidebar' })
          .evaluate((dialog) => dialog.contains(document.activeElement)),
      )
      .toBe(true);
    await page.evaluate(() => {
      if (document.activeElement instanceof HTMLElement)
        document.activeElement.blur();
    });
    await expect(organizationTrigger).not.toBeFocused();
  }
  if (view === 'organization-switcher-open' || view === 'user-menu-open') {
    await page.keyboard.press('Escape');
    if (viewport === 'mobile') await page.keyboard.press('Escape');
  } else if (view === 'sidebar-header-expanded' && viewport === 'mobile') {
    await page.keyboard.press('Escape');
  }
  return null;
}

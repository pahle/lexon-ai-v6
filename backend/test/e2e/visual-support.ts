import type { Locator, Page } from '@playwright/test';
import { expect } from '@playwright/test';
import { mkdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  assertIndexedArtifact,
  assertReviewArtifact,
  resolveVisualMode,
} from '../../../scripts/visual-mode.mjs';

export type VisualView = 'sign-in' | 'sign-up' | 'onboarding';
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

export function parseCheckpointCViewFilter(
  value: string,
  indexedViews: readonly string[],
): ReadonlySet<string> | null {
  const names = value
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (names.length === 0)
    throw new Error(
      'LEXON_CHECKPOINT_C_VIEWS must contain at least one indexed view.',
    );
  const indexed = new Set(indexedViews);
  const unknown = names.filter((name) => !indexed.has(name));
  if (unknown.length > 0)
    throw new Error(
      `Unknown Checkpoint C capture view(s): ${unknown.join(', ')}`,
    );
  return new Set(names);
}

let checkpointCFilterValue: string | undefined;
let checkpointCFilter: Promise<ReadonlySet<string> | null> | undefined;

async function shouldCaptureCheckpointCView(view: CheckpointCView) {
  const value = process.env.LEXON_CHECKPOINT_C_VIEWS;
  if (value === undefined) return true;
  if (value !== checkpointCFilterValue) {
    checkpointCFilterValue = value;
    checkpointCFilter = readFile(
      resolve('docs/references/F2.1-visual/index.json'),
      'utf8',
    ).then((contents) => {
      const index = JSON.parse(contents) as {
        checkpointC: { views: { id: string }[] };
      };
      return parseCheckpointCViewFilter(
        value,
        index.checkpointC.views.map(({ id }) => id),
      );
    });
  }
  if (!checkpointCFilter)
    throw new Error('Checkpoint C capture filter was not initialized.');
  const selected = await checkpointCFilter;
  return selected === null || selected.has(view);
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
  const output = resolve('.cache/f21-task7B', `${view}-${width}-${theme}.png`);
  await mkdir(resolve(output, '..'), { recursive: true });
  await page.mouse.move(0, 0);
  await page.screenshot({
    path: output,
    fullPage: false,
    caret: 'hide',
    animations: 'disabled',
    scale: 'css',
  });
}

export async function captureCheckpointCView(
  page: Page,
  view: CheckpointCView,
  theme: VisualTheme,
) {
  if (!(await shouldCaptureCheckpointCView(view))) return;
  await page.setViewportSize(sizes.desktop);
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
  if (process.env.LEXON_CAPTURE_CHECKPOINTS === '1') {
    const output = resolve(
      'docs/references/F2.1-visual/checkpoints',
      `c-${view}-${theme}.png`,
    );
    await mkdir(resolve(output, '..'), { recursive: true });
    await page.screenshot({
      path: output,
      fullPage: false,
      caret: 'hide',
      animations: 'disabled',
      scale: 'css',
    });
  }
}

export async function waitForVisualAuthFormReady(page: Page) {
  if (process.env.LEXON_VISUAL_DEV !== '1') return;
  await expect(page.locator('html')).toHaveAttribute(
    'data-lexon-visual-auth-ready',
    'true',
  );
}

export async function captureVisualView(
  page: Page,
  view: VisualView,
  theme: VisualTheme,
  viewport: VisualViewport,
) {
  await page.setViewportSize(sizes[viewport]);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.evaluate((value) => localStorage.setItem('theme', value), theme);
  const response = await page.reload();
  expect(response?.status()).toBe(200);
  if (view === 'onboarding') {
    await expect(page.getByLabel('Display name')).toHaveValue(
      'Checkpoint Preview',
    );
  } else {
    await waitForVisualAuthFormReady(page);
  }
  await expect(page.locator('main')).toHaveCount(1);
  expect(
    await page
      .locator('main')
      .evaluate((main) => Math.round(main.getBoundingClientRect().width)),
  ).toBe(sizes[viewport].width);
  expect(
    await page
      .locator('main input')
      .first()
      .evaluate((input) => Math.round(input.getBoundingClientRect().width)),
  ).toBe(320);
  await expect(page.locator('h1')).toBeVisible();
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
  await expect
    .poll(() =>
      page.locator('img[alt="Lexon"]').evaluateAll((images) =>
        images.every((image) => {
          const logo = image as HTMLImageElement;
          return logo.naturalWidth > 0 && logo.naturalHeight > 0;
        }),
      ),
    )
    .toBe(true);
  await expect(page.locator('img[alt="Lexon"]:visible')).toHaveCount(1);
  expect(
    await page
      .locator('img[alt="Lexon"]:visible')
      .evaluate((image) => image.getBoundingClientRect().width),
  ).toBeGreaterThan(0);
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
  if (process.env.LEXON_CAPTURE_CHECKPOINTS === '1') {
    const output = resolve(
      'docs/references/F2.1-visual/checkpoints',
      `a-${view}-${viewport}-${theme}.png`,
    );
    await mkdir(resolve(output, '..'), { recursive: true });
    await page.screenshot({
      path: output,
      fullPage: false,
      caret: 'hide',
      animations: 'disabled',
      scale: 'css',
    });
  }
}

export async function captureShellReviewView(
  page: Page,
  view: ShellReviewView,
  theme: VisualTheme,
  viewport: VisualViewport,
  outputDirectory = '.cache/f21-task6A',
  expectedHeading = 'Welcome, Checkpoint Preview',
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
  const index: Record<ShellReviewView, string> = {
    home: '10',
    'sidebar-expanded': '10',
    'sidebar-collapsed': '12',
    'organization-switcher-open': '13',
    'user-menu-open': '14',
  };
  const output = resolve(
    outputDirectory,
    `${index[view]}-${view}-${viewport}-${theme}.png`,
  );
  await mkdir(resolve(output, '..'), { recursive: true });
  await page.screenshot({
    path: output,
    fullPage: false,
    caret: 'hide',
    animations: 'disabled',
    scale: 'css',
  });
}

export async function installTask9SessionExpiryNormalization(
  page: Page,
  options: { hold?: Promise<void>; onRequest?: () => void } = {},
) {
  const index = JSON.parse(
    await readFile(resolve('docs/references/F2.1-visual/index.json'), 'utf8'),
  ) as {
    normalizations: {
      sessions: {
        fields: {
          createdAt: { fixedIso: string };
          expiresAt: { fixedIso: string };
        };
      };
    };
  };
  const createdAt = index.normalizations.sessions.fields.createdAt.fixedIso;
  const expiresAt = index.normalizations.sessions.fields.expiresAt.fixedIso;
  const pending = new Set<Promise<void>>();
  const sessionUrl = (url: URL) =>
    url.pathname === '/api/identity/sessions' && url.search === '';
  const sessionHandler = (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const handler = (async () => {
      options.onRequest?.();
      await options.hold;
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const rows = (await response.json()) as Array<Record<string, unknown>>;
      await route.fulfill({
        response,
        json: rows.map((row) => ({ ...row, createdAt, expiresAt })),
      });
    })();
    pending.add(handler);
    void handler.then(
      () => pending.delete(handler),
      () => pending.delete(handler),
    );
    return handler;
  };
  await page.route(sessionUrl, sessionHandler);
  return {
    async drain() {
      await Promise.all([...pending]);
    },
    async remove() {
      await page.unroute(sessionUrl, sessionHandler);
      await Promise.all([...pending]);
    },
  };
}

export async function installTask9InvitationExpiryNormalization(
  page: Page,
  activeTeamId: string,
) {
  const index = JSON.parse(
    await readFile(resolve('docs/references/F2.1-visual/index.json'), 'utf8'),
  ) as { normalizations: { invitationExpiresAt: { fixedIso: string } } };
  const expiresAt = index.normalizations.invitationExpiresAt.fixedIso;
  const pending = new Set<Promise<void>>();
  const invitationUrl = (url: URL) =>
    url.pathname === `/api/organizations/${activeTeamId}/invitations`;
  const invitationHandler = (route: import('@playwright/test').Route) => {
    if (route.request().method() !== 'GET') return route.continue();
    const handler = (async () => {
      const response = await route.fetch();
      if (!response.ok()) {
        await route.fulfill({ response });
        return;
      }
      const body = (await response.json()) as {
        items: Array<Record<string, unknown>>;
        [key: string]: unknown;
      };
      await route.fulfill({
        response,
        json: {
          ...body,
          items: body.items.map((invitation) => ({ ...invitation, expiresAt })),
        },
      });
    })();
    pending.add(handler);
    void handler.then(
      () => pending.delete(handler),
      () => pending.delete(handler),
    );
    return handler;
  };
  await page.route(invitationUrl, invitationHandler);
  return {
    async remove() {
      await page.unroute(invitationUrl, invitationHandler);
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
  const mode = resolveVisualMode();
  const index = JSON.parse(
    await readFile(resolve('docs/references/F2.1-visual/index.json'), 'utf8'),
  ) as {
    views: Record<
      string,
      { path: string; viewport: VisualViewport; theme: VisualTheme }
    >;
  };
  const id =
    view === 'sidebar-header-collapsed-desktop'
      ? `${view}-${theme}`
      : `${view}-${viewport}-${theme}`;
  const entry = index.views[id];
  if (!entry) throw new Error(`Visual index has no entry for view "${id}".`);
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
    const openNavigation = page.getByRole('button', {
      name: 'Open navigation',
    });
    if (await openNavigation.isVisible()) await openNavigation.click();
    await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
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
      const openNavigation = page.getByRole('button', {
        name: 'Open navigation',
      });
      if (await openNavigation.isVisible()) await openNavigation.click();
      await expect(page.getByRole('dialog', { name: 'Sidebar' })).toBeVisible();
    }
    const popup = page.getByTestId(
      view === 'organization-switcher-open'
        ? 'organization-popup'
        : 'user-menu-popup',
    );
    if (!(await popup.isVisible().catch(() => false))) {
      if (view === 'organization-switcher-open') {
        await page
          .locator('[data-slot="sidebar-header"] button[aria-haspopup="menu"]')
          .click();
      } else {
        await page
          .locator('[data-slot="sidebar-footer"] button[aria-haspopup="menu"]')
          .click();
      }
    }
    if (view === 'organization-switcher-open')
      await expect(page.getByTestId('organization-popup')).toBeVisible();
    else
      await expect(
        page.getByRole('menuitem', { name: 'Sign out' }),
      ).toBeVisible();
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
  if (mode === 'compare' || mode === 'update') {
    assertIndexedArtifact(index, id, resolve('docs/references/F2.1-visual'), {
      mode,
    });
    throw new Error(
      `Approved comparison for "${id}" is reserved for Task 10 baseline integration.`,
    );
  }
  const output = assertReviewArtifact(
    index,
    id,
    resolve('docs/references/F2.1-visual'),
  );
  await mkdir(resolve(output, '..'), { recursive: true });
  await page.screenshot({
    path: output,
    fullPage: false,
    caret: 'hide',
    animations: 'disabled',
    scale: 'css',
  });
  if (view === 'organization-switcher-open' || view === 'user-menu-open') {
    await page.keyboard.press('Escape');
    if (viewport === 'mobile') await page.keyboard.press('Escape');
  } else if (view === 'sidebar-header-expanded' && viewport === 'mobile') {
    await page.keyboard.press('Escape');
  }
  return output;
}

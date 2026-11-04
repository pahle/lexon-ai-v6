import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import {
  access,
  copyFile,
  cp,
  mkdir,
  readFile,
  realpath,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import net from 'node:net';
import path from 'node:path';
import { constants as fsConstants } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { chromium } from '@playwright/test';

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const evidenceRoot = path.join(repositoryRoot, 'docs/references/F2.1-visual');
const referenceRoot = path.join(evidenceRoot, 'reference');
const sourceManifestPath = path.join(referenceRoot, 'source-manifest.json');
const indexPath = path.join(evidenceRoot, 'index.json');
const baselineCssPath = path.join(referenceRoot, 'default-theme.css');
const baselineCssHash =
  '5d1960a157a8ffcaae854e4bb91dbc38188015f5f347bb5d44e392313c9e1d15';
const placeholderPath = path.join(referenceRoot, 'shadcn-placeholder.svg');

const captures = [
  {
    view: 'login-02',
    source: '@shadcn/login-02',
    path: '/login',
    applicability:
      'Sign-in comparison for published auth geometry; brand differences are expected later.',
  },
  {
    view: 'signup-02',
    source: '@shadcn/signup-02',
    path: '/signup',
    applicability:
      'Sign-up comparison for published auth geometry; brand differences are expected later.',
  },
  {
    view: 'sidebar-07',
    source: '@shadcn/sidebar-07',
    path: '/dashboard',
    applicability:
      'Workspace-shell comparison for the published sidebar and page-header geometry.',
  },
  {
    view: 'thread',
    source: '@assistant-ui/thread',
    path: '/reference/thread',
    applicability:
      'Empty assistant-thread comparison with the inert local runtime and published composer.',
  },
  {
    view: 'thread-list',
    source: '@assistant-ui/thread-list',
    path: '/reference/thread-list',
    applicability:
      'Empty assistant thread-list comparison with the inert local runtime.',
  },
];
const viewports = [
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'mobile', width: 390, height: 844 },
];

const sha256 = (value) => createHash('sha256').update(value).digest('hex');

export async function validateReferenceInputs({ cssPath, referencePaths }) {
  const resolvedCssPath = path.resolve(cssPath);
  const productionCssPath = path.join(
    repositoryRoot,
    'frontend/src/app/globals.css',
  );
  const canonicalCssPath = await realpath(resolvedCssPath);
  const canonicalProductionCssPath = await realpath(productionCssPath);
  if (
    canonicalCssPath === canonicalProductionCssPath ||
    resolvedCssPath.endsWith(
      `${path.sep}frontend${path.sep}src${path.sep}app${path.sep}globals.css`,
    )
  ) {
    throw new Error(`Refusing production CSS: ${resolvedCssPath}`);
  }

  await access(resolvedCssPath);
  for (const referencePath of referencePaths) {
    try {
      await access(path.resolve(referencePath));
      throw new Error(
        `Reference image already exists: ${path.resolve(referencePath)}`,
      );
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error;
    }
  }
}

export async function verifyGeneratedSources(manifest) {
  if (!manifest || !Array.isArray(manifest.generatedFiles)) {
    throw new Error('Source manifest must include generatedFiles');
  }

  for (const entry of manifest.generatedFiles) {
    if (
      !entry ||
      typeof entry.path !== 'string' ||
      !/^[a-f0-9]{64}$/i.test(entry.sha256 ?? '')
    ) {
      throw new Error(
        'Generated source manifest entries require a path and SHA-256 hash',
      );
    }
    const sourcePath = path.isAbsolute(entry.path)
      ? entry.path
      : path.join(repositoryRoot, entry.path);
    let source;
    try {
      source = await readFile(sourcePath);
    } catch (error) {
      if (entry.temporary && error?.code === 'ENOENT') continue;
      throw new Error(`Generated source missing: ${entry.path}`, {
        cause: error,
      });
    }
    const actualHash = sha256(source);
    if (actualHash !== entry.sha256.toLowerCase()) {
      throw new Error(`Generated source hash mismatch: ${entry.path}`);
    }
  }
}

async function readManifest() {
  return JSON.parse(await readFile(sourceManifestPath, 'utf8'));
}

async function selectFreePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  const { port } = server.address();
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
  return port;
}

async function waitForServer(url, child, logs) {
  const deadline = Date.now() + 90_000;
  let lastError;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(
        `Reference server exited (${child.exitCode}):\n${logs.join('')}`,
      );
    }
    try {
      const response = await fetch(url);
      if (response.ok) return;
      lastError = new Error(`Reference server returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(
    `Reference server did not become ready: ${lastError?.message ?? 'timeout'}\n${logs.join('')}`,
  );
}

async function writeFixture(root, manifest) {
  await mkdir(root, { recursive: true });
  const packageJson = JSON.parse(
    await readFile(path.join(repositoryRoot, 'frontend/package.json'), 'utf8'),
  );
  const packageSubset = {
    name: 'f2-pristine-reference',
    private: true,
    type: 'module',
    dependencies: packageJson.dependencies,
    devDependencies: packageJson.devDependencies,
  };
  await writeFile(
    path.join(root, 'package.json'),
    `${JSON.stringify(packageSubset, null, 2)}\n`,
  );
  await writeFile(
    path.join(root, 'postcss.config.mjs'),
    'export default { plugins: { "@tailwindcss/postcss": {} } };\n',
  );
  await writeFile(
    path.join(root, 'next.config.mjs'),
    `export default { devIndicators: false, turbopack: { root: ${JSON.stringify(repositoryRoot)} } };\n`,
  );
  await writeFile(
    path.join(root, 'tsconfig.json'),
    JSON.stringify(
      {
        compilerOptions: {
          target: 'ES2022',
          lib: ['dom', 'dom.iterable', 'esnext'],
          allowJs: true,
          skipLibCheck: true,
          strict: true,
          noEmit: true,
          esModuleInterop: true,
          module: 'esnext',
          moduleResolution: 'bundler',
          resolveJsonModule: true,
          isolatedModules: true,
          jsx: 'preserve',
          incremental: true,
          plugins: [{ name: 'next' }],
          paths: { '@/*': ['./*'] },
        },
        include: [
          'next-env.d.ts',
          '**/*.ts',
          '**/*.tsx',
          '.next/types/**/*.ts',
        ],
        exclude: ['node_modules'],
      },
      null,
      2,
    ),
  );
  await writeFile(path.join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  await writeFile(
    path.join(root, 'components.json'),
    JSON.stringify(
      {
        $schema: 'https://ui.shadcn.com/schema.json',
        style: 'base-nova',
        registries: {
          '@assistant-ui':
            'https://r.assistant-ui.com/styles/{style}/{name}.json',
        },
        rsc: true,
        tsx: true,
        tailwind: {
          config: '',
          css: 'app/globals.css',
          baseColor: 'zinc',
          cssVariables: true,
          prefix: '',
        },
        aliases: {
          components: '@/components',
          utils: '@/lib/utils',
          ui: '@/components/ui',
          lib: '@/lib',
          hooks: '@/hooks',
        },
        iconLibrary: 'lucide',
      },
      null,
      2,
    ),
  );

  for (const entry of manifest.generatedFiles) {
    const sourceRelativePath = entry.path.replace(/^frontend\/src\//, '');
    if (sourceRelativePath === entry.path) continue;
    const sourcePath = path.join(repositoryRoot, entry.path);
    try {
      await access(sourcePath);
    } catch (error) {
      if (entry.temporary && error?.code === 'ENOENT') continue;
      throw error;
    }
    const targetPath = path.join(root, sourceRelativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath);
  }

  const utilityPath = path.join(repositoryRoot, 'frontend/src/lib/utils.ts');
  await mkdir(path.join(root, 'lib'), { recursive: true });
  await cp(utilityPath, path.join(root, 'lib/utils.ts'));
  await mkdir(path.join(root, 'app'), { recursive: true });
  await cp(baselineCssPath, path.join(root, 'app/globals.css'));
  await writeFile(
    path.join(root, 'app/layout.tsx'),
    `import { Geist, Geist_Mono } from "next/font/google";\nimport { TooltipProvider } from "@/components/ui/tooltip";\nimport "./globals.css";\n\nconst geist = Geist({ subsets: ["latin"], variable: "--font-sans" });\nconst geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-mono" });\n\nexport default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {\n  return <html lang="en" className={\`${'${geist.variable} ${geistMono.variable} antialiased'}\`}><body><TooltipProvider>{children}</TooltipProvider></body></html>;\n}\n`,
  );
  await mkdir(path.join(root, 'public'), { recursive: true });
  await cp(placeholderPath, path.join(root, 'public/placeholder.svg'));

  const wrappers = [
    [
      'app/reference/thread/page.tsx',
      `"use client";\nimport { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";\nimport { useMemo } from "react";\nimport { Thread } from "@/components/assistant-ui/elements/thread.aui";\nconst adapter: ChatModelAdapter = { run: async () => { throw new Error("Chat is not available yet."); } };\nexport default function Page() { const model = useMemo(() => adapter, []); const runtime = useLocalRuntime(model, { initialMessages: [] }); return <AssistantRuntimeProvider runtime={runtime}><main className="h-svh w-full"><Thread /></main></AssistantRuntimeProvider>; }\n`,
    ],
    [
      'app/reference/thread-list/page.tsx',
      `"use client";\nimport { AssistantRuntimeProvider, useLocalRuntime, type ChatModelAdapter } from "@assistant-ui/react";\nimport { useMemo } from "react";\nimport { ThreadList } from "@/components/assistant-ui/elements/thread-list.aui";\nconst adapter: ChatModelAdapter = { run: async () => { throw new Error("Chat is not available yet."); } };\nexport default function Page() { const model = useMemo(() => adapter, []); const runtime = useLocalRuntime(model, { initialMessages: [] }); return <AssistantRuntimeProvider runtime={runtime}><main className="flex h-svh w-full flex-col gap-2 p-4"><ThreadList /></main></AssistantRuntimeProvider>; }\n`,
    ],
  ];
  for (const [relativePath, content] of wrappers) {
    const targetPath = path.join(root, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
  }
  await symlink(
    path.join(repositoryRoot, 'frontend/node_modules'),
    path.join(root, 'node_modules'),
    'dir',
  );
}

async function captureReferences() {
  const manifest = await readManifest();
  const expectedReferences = captures.flatMap(({ view }) =>
    viewports.map(({ name }) =>
      path.join(referenceRoot, `${view}-${name}-light.png`),
    ),
  );
  await verifyGeneratedSources(manifest);
  await validateReferenceInputs({
    cssPath: baselineCssPath,
    referencePaths: expectedReferences,
  });
  if (sha256(await readFile(baselineCssPath)) !== baselineCssHash) {
    throw new Error('Generated default CSS hash mismatch');
  }

  const fixtureRoot = path.join(
    repositoryRoot,
    '.cache/f2.1-reference',
    `capture-${process.pid}`,
  );
  await rm(fixtureRoot, { recursive: true, force: true });
  await writeFixture(fixtureRoot, manifest);
  const port = await selectFreePort();
  const serverUrl = `http://127.0.0.1:${port}`;
  const serverBinary = path.join(
    repositoryRoot,
    'frontend/node_modules/next/dist/bin/next',
  );
  const child = spawn(
    process.execPath,
    [serverBinary, 'dev', '--hostname', '127.0.0.1', '--port', String(port)],
    {
      cwd: fixtureRoot,
      env: { ...process.env, PORT: String(port), NEXT_TELEMETRY_DISABLED: '1' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  const logs = [];
  child.stdout.on('data', (chunk) => logs.push(chunk.toString()));
  child.stderr.on('data', (chunk) => logs.push(chunk.toString()));
  let browser;
  const indexEntries = [];
  const forbiddenRequests = [];
  const fontRequests = [];
  const outputRoot = path.join(fixtureRoot, 'output');

  try {
    await waitForServer(`${serverUrl}/login`, child, logs);
    browser = await chromium.launch({ headless: true });

    for (const { view, source, path: route } of captures) {
      for (const viewport of viewports) {
        const filename = `${view}-${viewport.name}-light.png`;
        const context = await browser.newContext({
          viewport: { width: viewport.width, height: viewport.height },
          deviceScaleFactor: 1,
          colorScheme: 'light',
          reducedMotion: 'reduce',
        });
        const page = await context.newPage();
        await page.route('**/*', async (routeRequest) => {
          const requestUrl = new URL(routeRequest.request().url());
          const isLoopback =
            requestUrl.hostname === '127.0.0.1' ||
            requestUrl.hostname === 'localhost';
          if (!isLoopback || requestUrl.pathname.startsWith('/api/')) {
            forbiddenRequests.push(requestUrl.href);
            await routeRequest.abort();
            return;
          }
          if (/\.(woff2?|ttf|otf)(?:$|\?)/i.test(requestUrl.href))
            fontRequests.push(requestUrl.href);
          await routeRequest.continue();
        });

        const response = await page.goto(`${serverUrl}${route}`, {
          waitUntil: 'domcontentloaded',
        });
        if (!response?.ok())
          throw new Error(
            `${route} returned ${response?.status() ?? 'no response'}`,
          );
        await page.locator('body').waitFor({ state: 'visible' });
        if (view === 'thread-list') {
          await page
            .locator('[data-slot="aui_thread-list-root"]')
            .waitFor({ state: 'visible' });
          await page
            .locator('[role="status"][aria-label="Loading threads"]')
            .waitFor({ state: 'detached' });
        }
        await page.evaluate(async () => {
          await document.fonts.ready;
          await Promise.all(
            [...document.images].map((image) =>
              image.decode().catch(() => undefined),
            ),
          );
        });
        if (page.url().includes('/_next/error'))
          throw new Error(`${route} rendered the Next.js error page`);
        if (await page.locator('#nextjs-portal').count())
          throw new Error(`${route} has a Next.js error overlay`);

        if (view === 'login-02' && viewport.name === 'desktop') {
          const metrics = await page.evaluate(() => {
            const input = document.querySelector('input[type="email"]');
            const button = document.querySelector('button[type="submit"]');
            const login = input?.closest('form');
            const cs = (element) =>
              element ? getComputedStyle(element) : null;
            return {
              fontFamily: cs(document.body)?.fontFamily,
              fontVariable: getComputedStyle(document.documentElement)
                .getPropertyValue('--font-sans')
                .trim(),
              loadedFonts: [
                ...new Set(
                  [...document.fonts]
                    .filter((font) => font.status === 'loaded')
                    .map((font) => font.family),
                ),
              ],
              fontReady: [...document.fonts].some(
                (font) =>
                  font.family.includes('Geist') && font.status === 'loaded',
              ),
              fontAssetRequests: performance
                .getEntriesByType('resource')
                .map((resource) => resource.name)
                .filter((name) =>
                  /\/_next\/static\/media\/.*\.woff2?(?:$|\?)/i.test(name),
                ),
              radius: Number.parseFloat(
                getComputedStyle(document.documentElement).getPropertyValue(
                  '--radius',
                ),
              ),
              inputHeight: input
                ? Math.round(input.getBoundingClientRect().height)
                : null,
              buttonHeight: button
                ? Math.round(button.getBoundingClientRect().height)
                : null,
              formFontSize: cs(login)?.fontSize,
              cssLinks: [
                ...document.querySelectorAll('link[rel="stylesheet"]'),
              ].map((link) => link.href),
            };
          });
          metrics.cssBundles = await page.evaluate(
            async (links) =>
              Promise.all(
                links.map(async (href) => {
                  const response = await fetch(href);
                  return { href, css: await response.text() };
                }),
              ),
            metrics.cssLinks,
          );
          metrics.cssBundleHashes = metrics.cssBundles.map(({ href, css }) => ({
            href,
            sha256: sha256(Buffer.from(css)),
            bytes: Buffer.byteLength(css),
          }));
          if (
            metrics.cssBundles.some(
              ({ css }) =>
                css.includes('--motion-duration') || css.includes('#F6EFE2'),
            )
          ) {
            throw new Error(
              'Production globals CSS token detected in the requested fixture stylesheet',
            );
          }
          delete metrics.cssBundles;
          manifest.renderMetrics = metrics;
          await writeFile(
            sourceManifestPath,
            `${JSON.stringify(manifest, null, 2)}\n`,
          );
          if (
            !metrics.fontReady ||
            !metrics.fontVariable ||
            !metrics.fontFamily.includes('Geist')
          ) {
            throw new Error(
              `Default Geist font did not resolve: ${JSON.stringify({ ...metrics, localFontRequests: fontRequests })}`,
            );
          }
          if (
            metrics.radius !== 0.625 ||
            metrics.inputHeight !== 32 ||
            metrics.buttonHeight !== 32
          ) {
            throw new Error(
              `Generated default geometry changed: ${JSON.stringify(metrics)}`,
            );
          }
          if (
            metrics.cssLinks.some((href) =>
              href.includes('frontend/src/app/globals.css'),
            )
          ) {
            throw new Error(
              'Production globals.css appears in the reference stylesheet graph',
            );
          }
        }

        await page.mouse.move(-1, -1);
        await mkdir(outputRoot, { recursive: true });
        const temporaryPath = path.join(outputRoot, filename);
        await page.screenshot({
          path: temporaryPath,
          type: 'png',
          fullPage: false,
          animations: 'disabled',
        });
        const png = await readFile(temporaryPath);
        const size = {
          width: png.readUInt32BE(16),
          height: png.readUInt32BE(20),
        };
        if (
          size.width !== viewport.width ||
          size.height !== viewport.height ||
          png.toString('ascii', 12, 16) !== 'IHDR'
        ) {
          throw new Error(
            `Incorrect screenshot output for ${filename}: ${JSON.stringify(size)}`,
          );
        }
        indexEntries.push({
          name: `${view}-${viewport.name}-light`,
          source,
          state: view.startsWith('login')
            ? 'Blank published sign-in form'
            : view.startsWith('signup')
              ? 'Blank published sign-up form'
              : view.startsWith('sidebar')
                ? 'Published sidebar-07 sample dashboard'
                : view === 'thread-list'
                  ? 'Inert empty thread-list state after client hydration'
                  : 'Inert empty chat state after client hydration',
          theme: 'light',
          viewport: viewport.name,
          applicability: captures.find((entry) => entry.view === view)
            .applicability,
          path: `reference/${filename}`,
          sha256: sha256(png),
          width: size.width,
          height: size.height,
          temporaryPath,
        });
        await context.close();
      }
    }

    if (forbiddenRequests.length)
      throw new Error(
        `Unexpected external/API requests: ${forbiddenRequests.join(', ')}`,
      );
    if (!fontRequests.some((url) => url.includes('/_next/static/media/'))) {
      throw new Error(
        'The generated Geist font was not served as a local font asset',
      );
    }
    await verifyGeneratedSources(manifest);
    await validateReferenceInputs({
      cssPath: baselineCssPath,
      referencePaths: expectedReferences,
    });
    manifest.referencePngs = indexEntries.map(
      ({ path: referencePath, sha256: hash, width, height }) => ({
        path: referencePath,
        sha256: hash,
        width,
        height,
        deviceScaleFactor: 1,
      }),
    );
    await writeFile(
      sourceManifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
    );
    for (const entry of indexEntries) {
      await copyFile(
        entry.temporaryPath,
        path.join(repositoryRoot, entry.path),
        fsConstants.COPYFILE_EXCL,
      );
      delete entry.temporaryPath;
    }
    const views = Object.fromEntries(
      indexEntries.map(
        ({ name, path, theme, viewport, state, source, applicability }) => [
          name,
          { path, theme, viewport, state, source, applicability },
        ],
      ),
    );
    await writeFile(
      indexPath,
      `${JSON.stringify(
        {
          version: 1,
          viewports: {
            desktop: { width: 1440, height: 900 },
            mobile: { width: 390, height: 844 },
          },
          deviceScaleFactor: 1,
          format: 'png',
          views,
        },
        null,
        2,
      )}\n`,
    );
  } finally {
    if (browser) await browser.close();
    try {
      process.kill(-child.pid, 'SIGTERM');
    } catch {
      // The process group has already exited.
    }
    await new Promise((resolve) => {
      if (child.exitCode !== null) return resolve();
      const timeout = setTimeout(resolve, 3000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGKILL');
      } catch {
        // The process group has already exited.
      }
    }
    await rm(fixtureRoot, { recursive: true, force: true });
  }
}

async function main() {
  await captureReferences();
  process.stdout.write('Captured 10 pristine reference PNGs.\n');
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  main().catch((error) => {
    process.stderr.write(`${error.stack ?? error}\n`);
    process.exitCode = 1;
  });
}

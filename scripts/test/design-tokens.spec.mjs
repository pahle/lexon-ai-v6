import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';

// LEX-DS-001 v3.0.1 (docs/specs/LEXON-03-DESIGN-SYSTEM.md): brand v4.1 tokens.
const frontendSource = new URL('../../frontend/src/', import.meta.url);
const css = readFileSync(new URL('app/globals.css', frontendSource), 'utf8');

const expected = {
  light: {
    background: '#ffffff',
    card: '#ffffff',
    popover: '#ffffff',
    muted: '#f5f4f4',
    border: '#eceaea',
    input: '#dddada',
    foreground: '#1a1718',
    'muted-foreground': '#6b6567',
    primary: '#b3202a',
    'primary-foreground': '#ffffff',
    secondary: '#f5f4f4',
    'secondary-foreground': '#1a1718',
    accent: '#f2f1f1',
    'accent-foreground': '#1a1718',
    destructive: '#8e1a22',
    ring: '#b3202a',
    sidebar: '#f5f4f4',
    'sidebar-primary': '#1a1718',
    'sidebar-primary-foreground': '#ffffff',
    'sidebar-accent': '#eceaea',
    'sidebar-border': '#e6e4e4',
    'lexon-destructive-fill': '#8e1a22',
    'lexon-red-text': '#b3202a',
    'lexon-tint': '#f7e6e8',
    'lexon-flag': '#fbf1f2',
    'lexon-deleted': '#9a9495',
    'lexon-user-bubble': '#f5f4f4',
    'lexon-night': '#080606',
    'lexon-warning': '#8a5300',
    'lexon-success': '#2f6b3a',
  },
  dark: {
    background: '#121011',
    card: '#1a1718',
    popover: '#1a1718',
    muted: '#242021',
    border: '#2c2829',
    input: '#57504f',
    foreground: '#f2f0f0',
    'muted-foreground': '#a69fa1',
    primary: '#b3202a',
    'primary-foreground': '#ffffff',
    secondary: '#242021',
    'secondary-foreground': '#f2f0f0',
    accent: '#242021',
    'accent-foreground': '#f2f0f0',
    destructive: '#f0646c',
    ring: '#f0646c',
    sidebar: '#181516',
    'sidebar-primary': '#f2f0f0',
    'sidebar-primary-foreground': '#121011',
    'sidebar-accent': '#2a2627',
    'sidebar-border': '#2c2829',
    'lexon-destructive-fill': '#8e1a22',
    'lexon-red-text': '#f0646c',
    'lexon-tint': '#3a1a1e',
    'lexon-flag': '#2a1517',
    'lexon-deleted': '#7d7678',
    'lexon-user-bubble': '#242021',
    'lexon-night': '#080606',
    'lexon-warning': '#e0a83a',
    'lexon-success': '#7cc08a',
  },
};

// LEX-DS-001 §2: these follow another token in both themes.
const derived = {
  'card-foreground': 'foreground',
  'popover-foreground': 'foreground',
  'sidebar-foreground': 'foreground',
  'sidebar-accent-foreground': 'foreground',
  'sidebar-ring': 'ring',
};

const charts = ['#b3202a', '#1a1718', '#6b6567', '#9a9495', '#dddada'];

const removedAliases = [
  'surface',
  'surface-raised',
  'primary-hover',
  'brand-sage',
  'danger',
  'warning',
  'success',
  'destructive-foreground',
];

const royalSeal = [
  '#f6efe2',
  '#eee4d2',
  '#e5d9c3',
  '#d8c9ad',
  '#1f1717',
  '#5e5248',
  '#7a1f2e',
  '#6a1a28',
  '#5f6b48',
  '#2a1519',
  '#3a1e24',
  '#4a2830',
  '#5a3a40',
  '#c9b9a6',
  '#a9b58f',
];

function parseBlock(selector) {
  const match = css.match(new RegExp(`${selector}\\s*\\{([^}]*)\\}`));
  assert.ok(match, `missing ${selector} token block`);
  return Object.fromEntries(
    [...match[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(([, key, value]) => [
      key,
      value.trim(),
    ]),
  );
}

function resolve(tokens, key, seen = new Set()) {
  assert.ok(key in tokens, `missing CSS variable --${key}`);
  assert.ok(!seen.has(key), `cyclic CSS variable alias at --${key}`);
  seen.add(key);
  const value = tokens[key];
  const alias = value.match(/^var\(--([\w-]+)\)$/);
  return alias ? resolve(tokens, alias[1], seen) : value.toLowerCase();
}

function luminance(hex) {
  const channels = hex.match(/^#([\da-f]{2})([\da-f]{2})([\da-f]{2})$/i);
  assert.ok(channels, `expected opaque hex color, received ${hex}`);
  return channels
    .slice(1)
    .map((part) => parseInt(part, 16) / 255)
    .map((value) =>
      value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4,
    )
    .reduce(
      (sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index],
      0,
    );
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

const light = parseBlock(':root');
const themes = { light, dark: { ...light, ...parseBlock('\\.dark') } };
const previews = {
  light: {
    ...light,
    ...parseBlock(
      "\\[data-slot='appearance-preview'\\]\\[data-theme-preview='light'\\],\\s*\\[data-preview-theme='light'\\]",
    ),
  },
  dark: {
    ...light,
    ...parseBlock(
      "\\[data-slot='appearance-preview'\\]\\[data-theme-preview='dark'\\],\\s*\\[data-preview-theme='dark'\\]",
    ),
  },
};

test('defines every LEX-DS-001 v3.0.1 token in the light and dark themes', () => {
  for (const [theme, expectedTokens] of Object.entries(expected)) {
    for (const [name, value] of Object.entries(expectedTokens))
      assert.equal(resolve(themes[theme], name), value, `${theme} --${name}`);
    for (const [name, source] of Object.entries(derived))
      assert.equal(
        resolve(themes[theme], name),
        expectedTokens[source],
        `${theme} --${name} follows --${source}`,
      );
  }
  charts.forEach((value, index) =>
    assert.equal(resolve(light, `chart-${index + 1}`), value),
  );
});

test('the Appearance previews show the same values as the real themes', () => {
  for (const [theme, expectedTokens] of Object.entries(expected)) {
    for (const [name, value] of Object.entries(expectedTokens))
      assert.equal(
        resolve(previews[theme], name),
        value,
        `${theme} preview --${name}`,
      );
    for (const [name, source] of Object.entries(derived))
      assert.equal(
        resolve(previews[theme], name),
        expectedTokens[source],
        `${theme} preview --${name}`,
      );
  }
});

test('exposes the Lexon tokens to Tailwind', () => {
  const theme = css.match(/@theme inline\s*\{([^}]*)\}/);
  assert.ok(theme, 'missing Tailwind inline theme block');
  for (const name of Object.keys(expected.light)) {
    assert.match(
      theme[1],
      new RegExp(`--color-${name}:\\s*var\\(--${name}\\);`),
      `--color-${name} maps to --${name}`,
    );
  }
});

test('the legacy Royal Seal aliases are gone', () => {
  for (const alias of removedAliases)
    assert.doesNotMatch(
      css,
      new RegExp(`--(?:color-)?${alias}\\s*:`),
      `--${alias} must not be defined`,
    );
});

test('no Royal Seal color remains in the frontend source', () => {
  const offenders = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        const text = readFileSync(path, 'utf8').toLowerCase();
        for (const color of royalSeal)
          if (text.includes(color)) offenders.push(`${path}: ${color}`);
      }
    }
  };
  visit(frontendSource.pathname);
  assert.deepEqual(offenders, []);
});

test('no retired heading size variable remains in the frontend source', () => {
  const offenders = [];
  const visit = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const path = join(directory, entry.name);
      if (entry.isDirectory()) visit(path);
      else if (/\.(ts|tsx|css)$/.test(entry.name)) {
        if (readFileSync(path, 'utf8').includes('--font-size-heading'))
          offenders.push(path);
      }
    }
  };
  visit(frontendSource.pathname);
  assert.deepEqual(offenders, []);
});

test('the Toaster carries no hard-coded color class or literal', () => {
  const toaster = readFileSync(
    new URL('components/ui/sonner.tsx', frontendSource),
    'utf8',
  );
  assert.doesNotMatch(toaster, /#[\da-f]{3,8}\b/i, 'no hex literal');
  assert.doesNotMatch(
    toaster,
    /\b(?:bg|text|border|ring|fill|stroke)-(?:red|orange|amber|yellow|green|emerald|teal|cyan|sky|blue|indigo|violet|purple|fuchsia|pink|rose|slate|gray|zinc|neutral|stone|black|white)\b/,
    'no palette color class',
  );
});

test('meets the measured contrast of LEX-DS-001 §2', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    const color = (name) => resolve(tokens, name);
    const atLeast = (text, surface, ratio) =>
      assert.ok(
        contrast(text, surface) >= ratio,
        `${theme}: ${text} on ${surface} must be >= ${ratio}:1, is ${contrast(text, surface).toFixed(2)}`,
      );
    for (const surface of ['background', 'card', 'muted']) {
      for (const text of [
        'foreground',
        'muted-foreground',
        'lexon-red-text',
        'lexon-warning',
        'lexon-success',
      ])
        atLeast(color(text), color(surface), 4.5);
    }
    for (const surface of ['background', 'muted'])
      atLeast(color('destructive'), color(surface), 4.5);
    for (const surface of ['sidebar', 'sidebar-accent']) {
      atLeast(color('foreground'), color(surface), 4.5);
      atLeast(color('muted-foreground'), color(surface), 4.5);
    }
    atLeast(color('primary-foreground'), color('primary'), 4.5);
    atLeast('#ffffff', color('lexon-destructive-fill'), 4.5);
    atLeast(color('lexon-red-text'), color('lexon-tint'), 4.5);
    atLeast(color('ring'), color('background'), 3);
    atLeast('#ffffff', color('lexon-night'), 4.5);
  }
  // The exact figures LEX-DS-001 §2 records for the reserved red.
  assert.equal(contrast('#ffffff', '#b3202a').toFixed(2), '6.65');
});

test('uses the DS radius token and shadcn-derived radius formulas', () => {
  assert.equal(resolve(light, 'radius'), '0.625rem');
  const theme = css.match(/@theme inline\s*\{([^}]*)\}/);
  assert.ok(theme, 'missing Tailwind inline theme block');
  for (const [alias, formula] of Object.entries({
    sm: 'calc(var(--radius) * 0.6)',
    md: 'calc(var(--radius) * 0.8)',
    lg: 'var(--radius)',
    xl: 'calc(var(--radius) * 1.4)',
    '2xl': 'calc(var(--radius) * 1.8)',
    '3xl': 'calc(var(--radius) * 2.2)',
    '4xl': 'calc(var(--radius) * 2.6)',
  })) {
    assert.match(
      theme[1],
      new RegExp(`--radius-${alias}:\\s*${formula.replace(/[()*]/g, '\\$&')}`),
      `--radius-${alias} must use the published shadcn derivation`,
    );
  }
  assert.match(css, /--right-panel-width:\s*320px/);
  assert.match(
    css,
    /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?animation-duration:\s*0s[\s\S]*?transition-duration:\s*0s/,
    'reduced-motion animations and transitions must have zero duration',
  );
});

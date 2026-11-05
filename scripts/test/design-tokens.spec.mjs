import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(
  new URL('../../frontend/src/app/globals.css', import.meta.url),
  'utf8',
);

const expected = {
  light: {
    background: '#f6efe2',
    card: '#eee4d2',
    popover: '#f6efe2',
    muted: '#e5d9c3',
    border: '#d8c9ad',
    foreground: '#1f1717',
    'muted-foreground': '#5e5248',
    primary: '#7a1f2e',
    'primary-hover': '#6a1a28',
    'primary-foreground': '#f6efe2',
    secondary: '#e5d9c3',
    'secondary-foreground': '#1f1717',
    accent: '#e5d9c3',
    'accent-foreground': '#1f1717',
    ring: '#7a1f2e',
    sidebar: '#eee4d2',
    'brand-sage': '#5f6b48',
    danger: '#b42318',
    warning: '#7a4f00',
    success: '#4e5a39',
  },
  dark: {
    background: '#2a1519',
    card: '#3a1e24',
    popover: '#3a1e24',
    muted: '#4a2830',
    border: '#5a3a40',
    foreground: '#f6efe2',
    'muted-foreground': '#c9b9a6',
    primary: '#f6efe2',
    'primary-foreground': '#2a1519',
    secondary: '#4a2830',
    'secondary-foreground': '#f6efe2',
    accent: '#4a2830',
    'accent-foreground': '#f6efe2',
    ring: '#f6efe2',
    sidebar: '#3a1e24',
    'brand-sage': '#a9b58f',
    danger: '#f97066',
    warning: '#e0a83a',
    success: '#a9b58f',
  },
};

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

test('exports the DS v2 light and dark tokens and shadcn aliases', () => {
  for (const [theme, expectedTokens] of Object.entries(expected)) {
    for (const [name, value] of Object.entries(expectedTokens)) {
      assert.equal(resolve(themes[theme], name), value, `${theme} --${name}`);
    }
    for (const alias of [
      'foreground',
      'muted-foreground',
      'primary-foreground',
      'secondary-foreground',
      'accent-foreground',
      'ring',
      'destructive',
      'destructive-foreground',
      'input',
      'card-foreground',
      'popover-foreground',
      'sidebar-foreground',
      'sidebar-primary',
      'sidebar-primary-foreground',
      'sidebar-accent',
      'sidebar-accent-foreground',
      'sidebar-border',
      'sidebar-ring',
    ]) {
      assert.ok(resolve(themes[theme], alias), `${theme} --${alias} resolves`);
    }
  }
});

test('meets DS v2 contrast requirements on specified text and status surfaces', () => {
  for (const [theme, tokens] of Object.entries(themes)) {
    const colors = Object.fromEntries(
      Object.keys(expected[theme]).map((key) => [key, resolve(tokens, key)]),
    );
    for (const surface of ['background', 'card', 'muted']) {
      for (const text of [
        'foreground',
        'muted-foreground',
        'danger',
        'warning',
        'success',
      ]) {
        assert.ok(
          contrast(colors[text], colors[surface]) >= 4.5,
          `${theme} ${text} on ${surface} must be >= 4.5:1`,
        );
      }
    }
    assert.ok(
      contrast(colors['primary-foreground'], colors.primary) >= 4.5,
      `${theme} primary-foreground on primary must be >= 4.5:1`,
    );
    assert.ok(
      contrast(colors.ring, colors.background) >= 3,
      `${theme} ring on background must be >= 3:1`,
    );
    for (const surface of ['background', 'card']) {
      assert.ok(
        contrast(colors['brand-sage'], colors[surface]) >= 4.5,
        `${theme} brand-sage text on ${surface} must be >= 4.5:1`,
      );
    }
  }
  assert.ok(
    contrast(resolve(light, 'brand-sage'), resolve(light, 'muted')) < 4.5,
    'light brand-sage must remain restricted from muted text',
  );
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

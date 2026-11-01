import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const css = readFileSync(
  new URL('../../frontend/src/app/globals.css', import.meta.url),
  'utf8',
);

const expected = {
  light: {
    background: '#ffffff',
    surface: '#f7f7f8',
    'surface-raised': '#ffffff',
    border: '#e5e5e9',
    text: '#0d0d0d',
    'text-muted': '#6e6e80',
    primary: '#0d0d0d',
    'on-primary': '#ffffff',
    accent: '#8e8ea0',
    'accent-strong': '#5d5d6e',
    'focus-ring': '#5d5d6e',
    danger: '#b42318',
    warning: '#8a5a00',
    success: '#1f7a3d',
  },
  dark: {
    background: '#121214',
    surface: '#1c1c20',
    'surface-raised': '#26262b',
    border: '#34343c',
    text: '#ececf1',
    'text-muted': '#a0a0b0',
    primary: '#ececf1',
    'on-primary': '#0d0d0d',
    accent: '#7a7a8c',
    'accent-strong': '#c2c2d0',
    'focus-ring': '#c2c2d0',
    danger: '#f97066',
    warning: '#e0a83a',
    success: '#4cc276',
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
  return channels.slice(1).map((part) => parseInt(part, 16) / 255)
    .map((value) => value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4)
    .reduce((sum, value, index) => sum + value * [0.2126, 0.7152, 0.0722][index], 0);
}

function contrast(first, second) {
  const values = [luminance(first), luminance(second)].sort((a, b) => b - a);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('exports every DSv1.2 color token in both themes and resolves shadcn aliases', () => {
  const themes = { light: parseBlock(':root'), dark: parseBlock('\\.dark') };
  for (const [theme, expectedTokens] of Object.entries(expected)) {
    for (const [name, value] of Object.entries(expectedTokens)) {
      assert.equal(resolve(themes[theme], name), value, `${theme} --${name}`);
    }
    for (const alias of [
      'foreground', 'muted-foreground', 'primary-foreground', 'ring',
      'destructive', 'card', 'card-foreground', 'popover',
      'popover-foreground', 'muted', 'input', 'sidebar',
      'sidebar-foreground', 'sidebar-primary', 'sidebar-primary-foreground',
      'sidebar-accent', 'sidebar-accent-foreground', 'sidebar-border',
      'sidebar-ring',
    ]) {
      assert.ok(resolve(themes[theme], alias), `${theme} --${alias} resolves`);
    }
  }
});

test('meets DSv1.2 text, button, focus, and non-text accent contrast rules', () => {
  const themes = { light: parseBlock(':root'), dark: parseBlock('\\.dark') };
  for (const [theme, expectedTokens] of Object.entries(expected)) {
    const colors = Object.fromEntries(
      Object.keys(expectedTokens).map((key) => [key, resolve(themes[theme], key)]),
    );
    for (const surface of ['background', 'surface', 'surface-raised']) {
      for (const text of ['text', 'text-muted', 'danger', 'warning', 'success']) {
        assert.ok(contrast(colors[text], colors[surface]) >= 4.5,
          `${theme} ${text} on ${surface} must be >= 4.5:1`);
      }
    }
    assert.ok(contrast(colors['on-primary'], colors.primary) >= 4.5,
      `${theme} primary button text must be >= 4.5:1`);
    for (const surface of ['background', 'surface', 'surface-raised']) {
      assert.ok(contrast(colors['focus-ring'], colors[surface]) >= 3,
        `${theme} focus ring on ${surface} must be >= 3:1`);
    }
    assert.ok(contrast(colors.accent, colors.background) >= 3,
      `${theme} accent non-text adjacency must be >= 3:1`);
  }
});

test('keeps shell dimensions, rectangular radius, system font, and reduced motion tokens', () => {
  const tokens = parseBlock(':root');
  assert.equal(resolve(tokens, 'right-panel-width'), '320px');
  assert.equal(resolve(tokens, 'sidebar-width'), '256px');
  assert.equal(resolve(tokens, 'radius'), '5px');
  assert.equal(resolve(tokens, 'motion-duration'), '400ms');
  assert.equal(resolve(tokens, 'motion-easing'), 'ease');
  assert.equal(resolve(tokens, 'font-system'), 'system-ui, sans-serif');
  assert.equal(resolve(tokens, 'font-mono'), 'ui-monospace, sfmono-regular, menlo, monospace');
  assert.equal(resolve(tokens, 'font-size-display'), '48px');
  assert.equal(resolve(tokens, 'font-size-heading'), '32px');
  assert.equal(resolve(tokens, 'font-size-body'), '16px');
  assert.equal(resolve(tokens, 'font-weight-display'), '700');
  assert.equal(resolve(tokens, 'font-weight-heading'), '600');
  assert.equal(resolve(tokens, 'font-weight-body'), '400');
  assert.equal(resolve(tokens, 'line-height-body'), '1.5');
  assert.equal(resolve(tokens, 'spacing-base'), '8px');
  assert.equal(resolve(tokens, 'spacing-scale'), '4px 8px 16px 24px 32px 40px 48px 64px');
  assert.equal(resolve(tokens, 'breakpoint-app'), '768px');
  assert.match(css, /@media\s*\(prefers-reduced-motion:\s*reduce\)[\s\S]*?--motion-duration:\s*0ms/);
  assert.match(css, /font-family:\s*var\(--font-system\)/);
  assert.doesNotMatch(css, /@import\s+(?:url\()?['"]https?:\/\/[^'"]+\.(?:woff2?|ttf|otf)/i);
});

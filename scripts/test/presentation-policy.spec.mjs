import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({
  cwd: new URL('../../', import.meta.url).pathname,
  overrideConfigFile: new URL('../../eslint.config.mjs', import.meta.url)
    .pathname,
});
const frontendEslint = new ESLint({
  cwd: new URL('../../frontend/', import.meta.url).pathname,
});

async function lint(filePath, code, config = eslint) {
  const [result] = await config.lintText(code, { filePath });
  assert.equal(result.fatalErrorCount, 0, JSON.stringify(result.messages));
  return result.messages;
}

test('rejects direct Radix imports, re-exports, and type-only imports in owned UI', async () => {
  const cases = [
    ["import 'radix-ui';", 'radix-ui'],
    [
      "export { Dialog } from '@radix-ui/react-dialog';",
      '@radix-ui/react-dialog',
    ],
    [
      "import type { DialogProps } from '@radix-ui/react-dialog';",
      '@radix-ui/react-dialog',
    ],
    [
      "export type { DialogProps } from '@radix-ui/react-dialog';",
      '@radix-ui/react-dialog',
    ],
  ];

  for (const [code, specifier] of cases) {
    for (const filePath of [
      new URL('../../frontend/src/policy.fixture.tsx', import.meta.url)
        .pathname,
      new URL('../../word-add-in/src/policy.fixture.tsx', import.meta.url)
        .pathname,
    ]) {
      const messages = await lint(filePath, code);
      assert.ok(
        messages.some((message) => message.ruleId === 'no-restricted-imports'),
        `${specifier} was not rejected in ${filePath}: ${JSON.stringify(messages)}`,
      );
    }
  }
});

test('allows the owned Base UI dependency', async () => {
  const messages = await lint(
    new URL('../../frontend/src/policy.fixture.tsx', import.meta.url).pathname,
    "import '@base-ui/react/dialog';",
  );
  assert.deepEqual(messages, []);
});

test('permits rounded-full only on named semantic slots in their owning files', async () => {
  const fixtures = [
    [
      'frontend/src/components/ui/radio-group.tsx',
      '<span data-slot="radio-indicator" className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/switch.tsx',
      '<span data-slot="switch-thumb" className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/avatar.tsx',
      '<span data-slot="avatar-initials" className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/status-dot.tsx',
      '<span data-slot="status-dot" className="rounded-full" />',
    ],
  ];

  for (const [path, code] of fixtures) {
    const messages = await lint(
      new URL(`../../${path}`, import.meta.url).pathname,
      code,
    );
    assert.deepEqual(messages, [], `${path}: ${JSON.stringify(messages)}`);
  }

  const frontendCwdMessages = await lint(
    new URL('../../frontend/src/components/ui/radio-group.tsx', import.meta.url)
      .pathname,
    '<span data-slot="radio-indicator" className="rounded-full" />',
    frontendEslint,
  );
  assert.deepEqual(frontendCwdMessages, []);

  const cvaMessages = await lint(
    new URL('../../frontend/src/components/ui/radio-group.tsx', import.meta.url)
      .pathname,
    "cva('rounded-full', { variants: { checked: { true: 'rounded-full' } } });",
  );
  assert.deepEqual(cvaMessages, []);
});

test('rejects rounded-full on buttons, inputs, badges, and arbitrary elements', async () => {
  const fixtures = [
    [
      'frontend/src/components/ui/button.tsx',
      '<button className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/input.tsx',
      '<input className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/badge.tsx',
      '<span data-slot="badge" className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/other.tsx',
      '<div className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/button.tsx',
      '<button data-slot="radio-indicator" className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/radio-group.tsx',
      '<span data-slot="radio-root" className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/radio-group.tsx',
      '<button data-slot="radio-indicator" className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/switch.tsx',
      '<input data-slot="switch-thumb" className="rounded-full" />',
    ],
    [
      'frontend/src/components/ui/avatar.tsx',
      '<Badge data-slot="avatar-initials" className="rounded-full" />',
    ],
  ];

  for (const [path, code] of fixtures) {
    const messages = await lint(
      new URL(`../../${path}`, import.meta.url).pathname,
      code,
    );
    assert.ok(
      messages.some((message) => message.ruleId === 'lexon/circular-shape'),
      `${path} was not rejected: ${JSON.stringify(messages)}`,
    );
  }
});

test('checks static JSX className and cva base/variant strings', async () => {
  const messages = await lint(
    new URL('../../frontend/src/components/ui/button.tsx', import.meta.url)
      .pathname,
    `
      import { cva } from 'class-variance-authority';
      const button = cva('rounded-full');
      const badge = cva('rounded-full', { variants: { size: { small: 'rounded-full' } } });
      const Dynamic = ({ classes }) => <div className={classes} />;
      const Static = () => <div className="rounded-full" />;
    `,
  );
  assert.equal(
    messages.filter((message) => message.ruleId === 'lexon/circular-shape')
      .length,
    4,
    JSON.stringify(messages),
  );
});

test('rejects variant-prefixed rounded-full class tokens', async () => {
  for (const token of ['md:rounded-full', 'hover:rounded-full']) {
    const messages = await lint(
      new URL('../../frontend/src/components/ui/button.tsx', import.meta.url)
        .pathname,
      `<button className="${token}" />`,
    );
    assert.ok(
      messages.some((message) => message.ruleId === 'lexon/circular-shape'),
      `${token} was not rejected: ${JSON.stringify(messages)}`,
    );
  }
});

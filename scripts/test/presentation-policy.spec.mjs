import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ESLint } from 'eslint';

const eslint = new ESLint({
  cwd: new URL('../../', import.meta.url).pathname,
  overrideConfigFile: new URL('../../eslint.config.mjs', import.meta.url)
    .pathname,
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

test('allows published rounded-full markup', async () => {
  const messages = await lint(
    new URL('../../frontend/src/components/ui/button.tsx', import.meta.url)
      .pathname,
    '<button className="rounded-full" />',
  );
  assert.deepEqual(messages, []);
});

test('rejects frontend business handlers, server actions, and model calls', async () => {
  const fixtures = [
    ['frontend/src/app/api/chat/route.ts', 'export async function POST() {}'],
    [
      'frontend/src/app/chat/actions.ts',
      "'use server'; export async function send() {}",
    ],
    ['frontend/src/components/chat.tsx', "import { generateText } from 'ai';"],
    ['frontend/src/components/chat.tsx', 'generateText({ model });'],
  ];
  for (const [path, code] of fixtures) {
    const messages = await lint(
      new URL(`../../${path}`, import.meta.url).pathname,
      code,
    );
    assert.ok(
      messages.some((message) => message.ruleId === 'lexon/server-boundary'),
      `${path} was not rejected: ${JSON.stringify(messages)}`,
    );
  }
  const health = await lint(
    new URL('../../frontend/src/app/health/route.ts', import.meta.url).pathname,
    'export async function GET() { return new Response("ok"); }',
  );
  assert.deepEqual(health, []);
});

test('allows only the approved public chat runtime adapter and message types', async () => {
  const runtimePath = new URL(
    '../../frontend/src/components/chat/chat-runtime.tsx',
    import.meta.url,
  ).pathname;
  const adapter = await lint(
    runtimePath,
    "import { useChat } from '@ai-sdk/react'; import { useAISDKRuntime } from '@assistant-ui/ai-sdk'; import type { UIMessage } from 'ai'; const chat = useChat({}); useAISDKRuntime(chat); const message: UIMessage = {} as UIMessage; void message;",
  );
  assert.deepEqual(adapter, []);

  const modelCall = await lint(
    runtimePath,
    "import { generateText } from 'ai'; generateText({});",
  );
  assert.ok(
    modelCall.some((message) => message.ruleId === 'lexon/server-boundary'),
    `Direct model generation was not rejected: ${JSON.stringify(modelCall)}`,
  );

  const unrelatedFrontend = await lint(
    new URL('../../frontend/src/components/other.tsx', import.meta.url)
      .pathname,
    "import { useChat } from '@ai-sdk/react';",
  );
  assert.ok(
    unrelatedFrontend.some(
      (message) => message.ruleId === 'lexon/server-boundary',
    ),
    `The runtime exception leaked into another component: ${JSON.stringify(unrelatedFrontend)}`,
  );
});

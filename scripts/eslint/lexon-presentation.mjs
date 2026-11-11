import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const serverBoundary = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      route: 'Frontend chat and business Route Handlers are not permitted.',
      serverAction: 'Frontend Server Actions are not permitted.',
      model:
        'Frontend model generation and AI transport calls are not permitted.',
    },
  },
  create(context) {
    const file = relative(repositoryRoot, context.filename)
      .split(sep)
      .join('/');
    if (!file.startsWith('frontend/src/')) return {};
    const runtimeAdapter =
      file === 'frontend/src/components/chat/chat-runtime.tsx';
    const clientMessageTypes = new Set([
      'ChatTransport',
      'CreateUIMessage',
      'UIMessage',
      'UIMessageChunk',
    ]);
    const isApprovedClientTypeImport = (node) =>
      node.importKind === 'type' &&
      node.source.value === 'ai' &&
      node.specifiers.length > 0 &&
      node.specifiers.every(
        (specifier) =>
          specifier.type === 'ImportSpecifier' &&
          clientMessageTypes.has(specifier.imported.name),
      );
    const isHealthRoute = file === 'frontend/src/app/health/route.ts';
    return {
      Program(node) {
        if (/\/route\.(?:[cm]?[jt]s|tsx|jsx)$/.test(file) && !isHealthRoute)
          context.report({ node, messageId: 'route' });
      },
      ExpressionStatement(node) {
        if (
          node.expression.type === 'Literal' &&
          node.expression.value === 'use server'
        ) {
          context.report({ node, messageId: 'serverAction' });
        }
      },
      ImportDeclaration(node) {
        if (
          node.source.value === 'ai' ||
          node.source.value === '@ai-sdk/react' ||
          node.source.value === '@assistant-ui/ai-sdk'
        ) {
          const approvedRuntimeImport =
            runtimeAdapter &&
            ((node.source.value === '@ai-sdk/react' &&
              node.specifiers.length === 1 &&
              node.specifiers[0]?.type === 'ImportSpecifier' &&
              node.specifiers[0].imported.name === 'useChat') ||
              (node.source.value === '@assistant-ui/ai-sdk' &&
                node.specifiers.length === 1 &&
                node.specifiers[0]?.type === 'ImportSpecifier' &&
                node.specifiers[0].imported.name === 'useAISDKRuntime'));
          if (
            approvedRuntimeImport ||
            (runtimeAdapter && isApprovedClientTypeImport(node)) ||
            (file === 'frontend/src/lib/chat-transport.ts' &&
              isApprovedClientTypeImport(node)) ||
            (file === 'frontend/src/lib/chat-stream.ts' &&
              isApprovedClientTypeImport(node))
          )
            return;
          context.report({ node, messageId: 'model' });
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          /^(generateText|streamText|generateObject|streamObject|useChat)$/.test(
            node.callee.name,
          ) &&
          !(runtimeAdapter && node.callee.name === 'useChat')
        ) {
          context.report({ node, messageId: 'model' });
        }
      },
    };
  },
};

export const presentationRules = {
  'server-boundary': serverBoundary,
};

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
          context.report({ node, messageId: 'model' });
        }
      },
      CallExpression(node) {
        if (
          node.callee.type === 'Identifier' &&
          /^(generateText|streamText|generateObject|streamObject|useChat)$/.test(
            node.callee.name,
          )
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

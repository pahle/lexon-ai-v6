import { dirname, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../..',
);

const circularSlots = new Map([
  ['frontend/src/components/ui/radio-group.tsx', 'radio-indicator'],
  ['frontend/src/components/ui/switch.tsx', 'switch-thumb'],
  ['frontend/src/components/ui/avatar.tsx', 'avatar-initials'],
  ['frontend/src/components/ui/status-dot.tsx', 'status-dot'],
]);

function containsCircularShape(value) {
  return value.split(/\s+/).some((token) => /(?:^|:)rounded-full$/.test(token));
}

function propertyValue(node, name) {
  if (node?.type !== 'ObjectExpression') return undefined;
  return node.properties?.find(
    (property) =>
      property.type === 'Property' &&
      !property.computed &&
      (property.key.name ?? property.key.value) === name,
  )?.value;
}

function staticStrings(node) {
  if (!node) return [];
  if (node.type === 'Literal' && typeof node.value === 'string') return [node];
  if (node.type !== 'ObjectExpression') return [];

  return node.properties.flatMap((property) => {
    if (property.type !== 'Property') return [];
    return staticStrings(property.value);
  });
}

function classNames(node) {
  if (node.type === 'Literal' && typeof node.value === 'string') return [node];
  if (
    node.type === 'JSXExpressionContainer' &&
    node.expression.type === 'Literal' &&
    typeof node.expression.value === 'string'
  ) {
    return [node.expression];
  }
  return [];
}

const circularShape = {
  meta: {
    type: 'problem',
    schema: [],
    messages: {
      forbidden:
        'rounded-full is reserved for the matching semantic circular-shape slot in its owning control file.',
    },
  },
  create(context) {
    const file = relative(repositoryRoot, context.filename)
      .split(sep)
      .join('/');
    const allowedSlot = circularSlots.get(file);

    function report(node) {
      context.report({ node, messageId: 'forbidden' });
    }

    function checkString(node, permitted) {
      if (containsCircularShape(node.value) && !permitted) report(node);
    }

    function isAllowedSlot(node) {
      if (!allowedSlot) return false;
      const elementName = node.name?.type === 'JSXIdentifier' && node.name.name;
      if (
        elementName &&
        ['button', 'input', 'badge'].includes(elementName.toLowerCase())
      )
        return false;
      const slot = node.attributes.find(
        (attribute) =>
          attribute.type === 'JSXAttribute' &&
          attribute.name.type === 'JSXIdentifier' &&
          attribute.name.name === 'data-slot',
      );
      return (
        slot?.value?.type === 'Literal' && slot.value.value === allowedSlot
      );
    }

    return {
      JSXAttribute(node) {
        if (
          node.name.type !== 'JSXIdentifier' ||
          node.name.name !== 'className' ||
          node.value == null
        ) {
          return;
        }
        const permitted = isAllowedSlot(node.parent);
        for (const literal of classNames(node.value))
          checkString(literal, permitted);
      },
      CallExpression(node) {
        if (node.callee.type !== 'Identifier' || node.callee.name !== 'cva')
          return;
        const permitted = allowedSlot !== undefined;
        for (const literal of staticStrings(node.arguments[0]))
          checkString(literal, permitted);

        const variants = propertyValue(node.arguments[1], 'variants');
        for (const literal of staticStrings(variants))
          checkString(literal, permitted);
      },
    };
  },
};

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
  'circular-shape': circularShape,
  'server-boundary': serverBoundary,
};

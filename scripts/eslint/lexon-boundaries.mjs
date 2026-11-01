import { classifyImport } from './resolve-import.mjs';

export default {
  rules: {
    boundaries: {
      meta: {
        type: 'problem',
        schema: [
          {
            type: 'object',
            properties: { root: { type: 'string' } },
            additionalProperties: false,
          },
        ],
        messages: {
          boundary:
            '[{{rule}}] Import {{specifier}} violates the Lexon module boundary.',
        },
      },
      create(context) {
        const root = context.options[0]?.root ?? context.cwd;
        function report(node, rule, specifier) {
          context.report({
            node,
            messageId: 'boundary',
            data: { rule, specifier },
          });
        }
        function inspect(node, source) {
          if (!source || typeof source.value !== 'string') return;
          const typeOnly =
            node.importKind === 'type' ||
            (node.specifiers?.length > 0 &&
              node.specifiers.every((item) => item.importKind === 'type'));
          const names = (node.specifiers ?? []).map(
            (item) => item.imported?.name ?? '*',
          );
          const decision = classifyImport({
            root,
            importer: context.filename,
            specifier: source.value,
            names,
            typeOnly,
          });
          if (!decision.allowed) report(source, decision.ruleId, source.value);
        }
        return {
          ImportDeclaration(node) {
            inspect(node, node.source);
          },
          ExportNamedDeclaration(node) {
            inspect(node, node.source);
          },
          ExportAllDeclaration(node) {
            inspect(node, node.source);
          },
          ImportExpression(node) {
            if (typeof node.source.value !== 'string')
              report(node, 'dynamic-import', '<computed>');
            else inspect(node, node.source);
          },
          Identifier(node) {
            const parent = node.parent;
            const namedKey =
              [
                'Property',
                'MethodDefinition',
                'PropertyDefinition',
                'TSMethodSignature',
                'TSPropertySignature',
              ].includes(parent.type) &&
              parent.key === node &&
              !parent.computed &&
              !parent.shorthand;
            const memberKey =
              parent.type === 'MemberExpression' &&
              parent.property === node &&
              !parent.computed;
            if (node.name === 'require' && !namedKey && !memberKey)
              report(node, 'require-import', 'require');
          },
        };
      },
    },
  },
};

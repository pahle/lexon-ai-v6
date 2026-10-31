import { existsSync, realpathSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import ts from 'typescript';

const workspace = {
  '@lexon/backend': 'backend',
  '@lexon/frontend': 'frontend',
  '@lexon/contracts': 'shared',
  '@lexon/evals': 'evals',
};
const builtinNames = new Set(
  builtinModules.flatMap((name) => [name, `node:${name}`]),
);
export const isNodeBuiltin = (specifier) =>
  builtinNames.has(specifier) || specifier.startsWith('node:');

function actualPath(path) {
  const candidate = [
    path,
    path.replace(/\.js$/, '.ts'),
    `${path}.ts`,
    join(path, 'index.ts'),
  ].find(existsSync);
  return candidate ? realpathSync(candidate) : resolve(path);
}

export function resolveImport({ root, importer, specifier }) {
  const source = actualPath(
    isAbsolute(importer) ? importer : join(root, importer),
  );
  const sourcePackage = relative(root, source).split('/')[0];
  if (specifier.startsWith('.') || isAbsolute(specifier))
    return actualPath(resolve(dirname(source), specifier));
  for (const [name, folder] of Object.entries(workspace)) {
    if (specifier === name || specifier.startsWith(`${name}/`)) {
      const subpath = specifier.slice(name.length).replace(/^\//, '');
      if (folder === 'backend' && subpath === 'evaluation')
        return actualPath(join(root, folder, 'src/evaluation/index.ts'));
      return actualPath(join(root, folder, subpath || 'src/index.ts'));
    }
  }
  const configPath = ts.findConfigFile(
    dirname(source),
    ts.sys.fileExists,
    'tsconfig.json',
  );
  if (configPath) {
    const file = ts.readConfigFile(configPath, ts.sys.readFile);
    if (!file.error) {
      const config = ts.parseJsonConfigFileContent(
        file.config,
        ts.sys,
        dirname(configPath),
      );
      const resolved = ts.resolveModuleName(
        specifier,
        source,
        config.options,
        ts.sys,
      ).resolvedModule;
      if (resolved && !resolved.isExternalLibraryImport)
        return actualPath(resolved.resolvedFileName);
      // Resolve declared aliases even before a future slice creates its files.
      for (const [pattern, values] of Object.entries(
        config.options.paths ?? {},
      )) {
        const [prefix, suffix = ''] = pattern.split('*');
        if (
          specifier.startsWith(prefix) &&
          specifier.endsWith(suffix) &&
          (pattern.includes('*') || specifier === pattern)
        ) {
          const tail = specifier.slice(
            prefix.length,
            suffix ? -suffix.length : undefined,
          );
          return actualPath(
            resolve(
              config.options.baseUrl ?? dirname(configPath),
              values[0].replace('*', tail),
            ),
          );
        }
      }
    }
  }
  const manifest = join(root, sourcePackage, 'package.json');
  if (specifier.startsWith('#') && existsSync(manifest)) {
    const target = JSON.parse(readFileSync(manifest, 'utf8')).imports?.[
      specifier
    ];
    if (typeof target === 'string')
      return actualPath(resolve(dirname(manifest), target));
  }
  return null;
}

const databasePackage = (value) => /^(?:pg|drizzle-orm)(?:\/|$)/.test(value);
const aiPackage = (value) =>
  value === 'ai' ||
  value.startsWith('ai/') ||
  (value.startsWith('@ai-sdk/') && value !== '@ai-sdk/react') ||
  value === '@openrouter/ai-sdk-provider' ||
  value.startsWith('@openrouter/ai-sdk-provider/');
const clientAiNames = new Set([
  'UIMessage',
  'UIMessagePart',
  'ChatTransport',
  'DefaultChatTransport',
  'AbstractChat',
  'ChatStatus',
]);

export function classifyImport({
  importer,
  specifier,
  root,
  names = [],
  typeOnly = false,
}) {
  const source = relative(root, resolve(importer)).replaceAll('\\', '/');
  const owner = source.split('/')[0];
  const targetPath = resolveImport({ importer, specifier, root });
  const target = targetPath
    ? relative(root, targetPath).replaceAll('\\', '/')
    : null;
  const targetOwner = target?.split('/')[0];
  const deny = (ruleId) => ({ allowed: false, ruleId });
  const inDb = source.startsWith('backend/src/infrastructure/db/');
  const inAi = source.startsWith('backend/src/infrastructure/ai/');
  if (databasePackage(specifier) && !inDb) return deny('database-owner');
  if (aiPackage(specifier) && !inAi) {
    const client =
      owner === 'frontend' &&
      specifier === 'ai' &&
      typeOnly &&
      names.length > 0 &&
      names.every((name) => clientAiNames.has(name));
    if (!client) return deny('ai-owner');
  }
  if (
    owner === 'shared' &&
    (isNodeBuiltin(specifier) || (targetOwner && targetOwner !== 'shared'))
  )
    return deny('shared-browser');
  if (owner === 'frontend') {
    if (targetOwner === 'backend') return deny('frontend-backend');
    if (isNodeBuiltin(specifier) || specifier === 'server-only')
      return deny('frontend-server');
    if (target && !['frontend', 'shared'].includes(targetOwner))
      return deny('frontend-local');
  }
  if (
    owner === 'evals' &&
    targetOwner === 'backend' &&
    specifier !== '@lexon/backend/evaluation'
  )
    return deny('eval-entry');
  if (
    owner === 'evals' &&
    target &&
    !['evals', 'shared', 'backend'].includes(targetOwner)
  )
    return deny('eval-entry');
  if (owner === 'backend' && targetOwner === 'frontend')
    return deny('backend-frontend');
  const domain = source.match(/^backend\/src\/modules\/([^/]+)\//)?.[1];
  const targetDomain = target?.match(/^backend\/src\/modules\/([^/]+)\/(.*)$/);
  if (
    domain &&
    targetDomain &&
    domain !== targetDomain[1] &&
    !['index.ts', 'index.js'].includes(targetDomain[2])
  )
    return deny('domain-public');
  return { allowed: true, ruleId: null };
}

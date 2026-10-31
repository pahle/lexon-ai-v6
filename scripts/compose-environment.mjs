import { readFile, writeFile, mkdir, rename, rm } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { parseEnv } from 'node:util';
import { join } from 'node:path';
import { readContainerImages } from './container-images.mjs';
export const root = new URL('../', import.meta.url).pathname;
export async function composeEnvironment(input, directory) {
  const images = readContainerImages(join(root, 'config/container-images.env'));
  const env = {
    ...input,
    NODE_IMAGE: images.node,
    POSTGRES_IMAGE: images.postgres,
    VALKEY_IMAGE: images.valkey,
    SEAWEEDFS_IMAGE: images.seaweedfs,
  };
  const required = [
    'POSTGRES_ADMIN_PASSWORD',
    'DATABASE_MIGRATOR_PASSWORD',
    'DATABASE_APP_PASSWORD',
    'DATABASE_AUTH_PASSWORD',
    'VALKEY_PASSWORD',
    'S3_ACCESS_KEY',
    'S3_SECRET_KEY',
    'S3_BUCKET',
  ];
  for (const key of required)
    if (!env[key] || env[key] === 'REPLACE_ME')
      throw new Error(`Configure ${key} in .env`);
  const dbName = env.DATABASE_NAME ?? 'lexon';
  if (!/^[a-z][a-z0-9_]{0,62}$/.test(dbName))
    throw new Error('Invalid database name');
  env.DATABASE_NAME = dbName;
  const dbUrl = (role, password, database) => {
    const url = new URL('postgresql://postgres:5432');
    url.username = role;
    url.password = password;
    url.pathname = '/' + database;
    return url.href;
  };
  env.DATABASE_ADMIN_URL = dbUrl(
    'postgres',
    env.POSTGRES_ADMIN_PASSWORD,
    'postgres',
  );
  env.DATABASE_MIGRATOR_URL = dbUrl(
    'lexon_migrator',
    env.DATABASE_MIGRATOR_PASSWORD,
    dbName,
  );
  env.DATABASE_APP_URL = dbUrl('lexon_app', env.DATABASE_APP_PASSWORD, dbName);
  const redis = new URL('redis://valkey:6379/0');
  redis.password = env.VALKEY_PASSWORD;
  for (const kind of ['QUEUE', 'STREAMS', 'LIMITER'])
    env[`VALKEY_${kind}_URL`] = redis.href;
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const configPath = join(directory, 's3.json');
  const temporary = join(directory, `s3-${randomUUID()}.tmp`);
  try {
    await writeFile(
      temporary,
      JSON.stringify({
        identities: [
          {
            name: 'lexon',
            credentials: [
              { accessKey: env.S3_ACCESS_KEY, secretKey: env.S3_SECRET_KEY },
            ],
            actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
          },
        ],
      }),
      // The private parent directory protects host access. The read-only file
      // mount must remain readable after the image drops to its seaweed user.
      { mode: 0o444 },
    );
    await rename(temporary, configPath);
  } finally {
    await rm(temporary, { force: true });
  }
  env.S3_CONFIG_PATH = configPath;
  return env;
}
export async function localEnvironment() {
  try {
    return {
      ...parseEnv(await readFile(join(root, '.env'), 'utf8')),
      ...process.env,
    };
  } catch (error) {
    if (error.code === 'ENOENT')
      // eslint-disable-next-line preserve-caught-error -- Do not expose local environment file details.
      throw new Error('Copy .env.example to .env and replace its placeholders');
    throw error;
  }
}

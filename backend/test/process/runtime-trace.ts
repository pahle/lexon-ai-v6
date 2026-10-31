import { registerHooks } from 'node:module';
import { Server } from 'node:net';
import type { RuntimeConfig } from '../../src/config/runtime-config.js';
const loaded = new Set<string>();
let listeners = 0;
const listen = Server.prototype.listen;
Server.prototype.listen = function (
  this: Server,
  ...args: Parameters<Server['listen']>
) {
  listeners++;
  return listen.apply(this, args);
} as Server['listen'];
registerHooks({
  load(url, context, next) {
    loaded.add(url);
    return next(url, context);
  },
});
process.once('message', async (config: RuntimeConfig) => {
  const { createRuntimeContext } =
    await import('../../src/bootstrap/context.js');
  const app = await createRuntimeContext('document-worker', config);
  await app.close();
  process.send?.({ loaded: [...loaded], listeners }, () =>
    process.disconnect(),
  );
});

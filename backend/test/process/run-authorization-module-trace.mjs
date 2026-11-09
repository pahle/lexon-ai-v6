import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';
import net from 'node:net';
import tls from 'node:tls';
import { isForbiddenAuthorizationImport } from './authorization-import-policy.mjs';

const imports = [];
const networkCalls = [];
registerHooks({
  resolve(specifier, context, nextResolve) {
    imports.push(specifier);
    return nextResolve(specifier, context);
  },
});

const socketConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function (...args) {
  networkCalls.push('net.Socket.connect');
  return socketConnect.apply(this, args);
};
const serverListen = net.Server.prototype.listen;
net.Server.prototype.listen = function (...args) {
  networkCalls.push('net.Server.listen');
  return serverListen.apply(this, args);
};
const tlsConnect = tls.connect;
tls.connect = function (...args) {
  networkCalls.push('tls.connect');
  return tlsConnect.apply(this, args);
};

const [
  { NestFactory },
  { RunAuthorizationModule },
  { RunAuthorizationService },
] = await Promise.all([
  import('@nestjs/core'),
  import('../../dist/modules/identity-access/run-authorization.module.js'),
  import('../../dist/modules/identity-access/run-authorization.service.js'),
]);
const application = await NestFactory.createApplicationContext(
  RunAuthorizationModule,
  { logger: false },
);
assert.ok(application.get(RunAuthorizationService));
await application.close();

const forbiddenImports = imports.filter(isForbiddenAuthorizationImport);
assert.deepEqual(forbiddenImports, []);
assert.deepEqual(networkCalls, []);
process.stdout.write(
  JSON.stringify({
    importedModules: imports.length,
    forbiddenImports,
    networkCalls,
  }),
);

import { AuthModule } from '@thallesp/nestjs-better-auth';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { AuthEngineOptions } from './auth-types.js';
import { composeAuthIntegration } from './auth-integration.js';
export async function createAuthRuntime(options: AuthEngineOptions) {
  const { auth, integration } = await composeAuthIntegration(options);
  return {
    integration,
    mount(
      handler: (request: Request) => Promise<Response>,
      middleware: (
        req: IncomingMessage & { originalUrl?: string },
        res: ServerResponse,
        next: () => void,
      ) => void,
    ) {
      return AuthModule.forRoot({
        auth: { ...auth, handler },
        disableGlobalAuthGuard: true,
        isGlobal: false,
        disableTrustedOriginsCors: true,
        middleware,
        bodyParser: { json: { limit: '32kb' }, urlencoded: { enabled: false } },
      });
    },
  };
}

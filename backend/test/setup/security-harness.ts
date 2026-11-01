import type { createAuthFixture } from '../../src/infrastructure/db/testing/auth-fixture.js';
import { SecurityService } from '../../src/modules/identity-access/security.service.js';
import {
  withVerifiedIdentity,
  type VerifiedIdentity,
} from '../../src/modules/identity-access/identity.types.js';
import { totpForUri } from './totp.js';
import { authResponseCookies } from '../../src/modules/identity-access/auth-response-cookies.js';

export const responseCookies = (response: Response) =>
  authResponseCookies(response) ?? new Headers();
export function securityHarness(
  proof: Awaited<ReturnType<typeof createAuthFixture>>,
) {
  const service = new SecurityService(proof.integration, {
    reauthSeconds: 300,
  });
  const run = (path: string, body: Record<string, unknown>, headers: Headers) =>
    proof.integration.transaction(async (tx) => {
      const done = await service.prepareOperation(tx, path, body, headers);
      const response = await proof.integration.handle(
        new Request(`${proof.origin}/api/auth${path}`, {
          method: 'POST',
          headers: new Headers({
            ...Object.fromEntries(headers),
            origin: proof.origin,
            'content-type': 'application/json',
          }),
          body: JSON.stringify(body),
        }),
      );
      if (response.status >= 400)
        throw new Error('Native factor operation failed');
      return done(response);
    });
  return {
    service,
    run,
    async enroll(email: string, password: string) {
      const signin = await run(
        '/sign-in/email',
        { email, password },
        new Headers(),
      );
      const headers = responseCookies(signin);
      const setup = (await (
        await run('/two-factor/enable', { password }, headers)
      ).json()) as { totpURI: string; backupCodes: string[] };
      const verified = await run(
        '/two-factor/verify-totp',
        { code: totpForUri(setup.totpURI) },
        headers,
      );
      return { headers: responseCookies(verified), ...setup };
    },
    async identity<T>(
      headers: Headers,
      work: (identity: VerifiedIdentity) => Promise<T>,
    ) {
      const session = await proof.integration.transaction((tx) =>
        tx.call('getSession', { headers, query: { disableRefresh: true } }),
      );
      if (!session) throw new Error('Missing test session');
      const personal = await proof.inspect.personalFor(session.user.id);
      return withVerifiedIdentity(
        {
          userId: session.user.id,
          sessionId: session.session.id,
          activeOrganizationId:
            session.session.activeOrganizationId ?? personal!.orgId,
          channel: session.session.channel,
          platformAdmin: false,
          mfaVerifiedAt: session.session.mfaVerifiedAt ?? null,
          reauthenticatedAt: session.session.reauthenticatedAt ?? null,
        },
        work,
        headers,
      );
    },
  };
}

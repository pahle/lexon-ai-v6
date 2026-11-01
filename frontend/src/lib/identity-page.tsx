import { cookies } from 'next/headers';
import { createServerIdentityClient } from './server-identity-client';
import { IdentityClientError } from './identity-client';
import { SessionBoundary } from '../components/auth/session-boundary';
export async function loadIdentityPage() {
  const api = createServerIdentityClient({
    cookie: (await cookies()).toString(),
  });
  try {
    return { api, identity: await api.identity() };
  } catch (error) {
    if (
      error instanceof IdentityClientError &&
      error.code === 'AUTH_2FA_REQUIRED'
    )
      return {
        view: (
          <main className="mx-auto max-w-md p-6">
            <p>Verify your sign-in to continue.</p>
            <a href="/two-factor?returnTo=%2Fworkspace">Verify your sign-in</a>
            <a href="/account/security">Account security</a>
          </main>
        ),
      };
    return {
      view: (
        <SessionBoundary
          state={
            error instanceof IdentityClientError && error.status === 401
              ? 'expired'
              : 'unavailable'
          }
        >
          {null}
        </SessionBoundary>
      ),
    };
  }
}

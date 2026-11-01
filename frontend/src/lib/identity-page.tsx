import { cookies } from 'next/headers';
import { createServerIdentityClient } from './server-identity-client';
import { loadWorkspaceBootstrap } from './workspace-bootstrap';
import { SessionBoundary } from '../components/auth/session-boundary';

export async function loadIdentityPage() {
  const bootstrap = await loadWorkspaceBootstrap();
  if (bootstrap.status === 'ready')
    return {
      api: createServerIdentityClient({ cookie: (await cookies()).toString() }),
      identity: bootstrap.identity,
    };
  if (bootstrap.status === 'mfa-required')
    return {
      view: (
        <section className="mx-auto max-w-md p-6">
          <p>Verify your sign-in to continue.</p>
          <a href="/two-factor?returnTo=%2Fworkspace">Verify your sign-in</a>
          <a href="/account/security">Account security</a>
        </section>
      ),
    };
  return {
    view: (
      <SessionBoundary
        embedded
        state={bootstrap.status === 'expired' ? 'expired' : 'unavailable'}
      >
        {null}
      </SessionBoundary>
    ),
  };
}

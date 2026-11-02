import { cookies } from 'next/headers';
import { createServerIdentityClient } from './server-identity-client';
import { IdentityClientError } from './identity-client';
import type { WorkspaceBootstrap } from '../components/shell/workspace-provider';

export async function loadWorkspaceBootstrap(): Promise<WorkspaceBootstrap> {
  const api = createServerIdentityClient({
    cookie: (await cookies()).toString(),
  });
  try {
    return { status: 'ready', identity: await api.identity() };
  } catch (error) {
    if (
      error instanceof IdentityClientError &&
      error.code === 'AUTH_2FA_REQUIRED'
    )
      return { status: 'mfa-required' };
    if (error instanceof IdentityClientError && error.status === 401)
      return { status: 'expired' };
    return { status: 'unavailable' };
  }
}

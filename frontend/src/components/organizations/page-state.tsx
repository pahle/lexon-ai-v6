'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Page } from '@lexon/contracts';
import {
  createIdentityClient,
  IdentityClientError,
} from '../../lib/identity-client';
import { SessionBoundary } from '../auth/session-boundary';
import { Button } from '../ui/button';
import { ErrorState } from '../states/page-states';
export const identityApi = createIdentityClient({ baseUrl: '/api' });
export function identityMessage(error: unknown): string {
  return error instanceof IdentityClientError && error.code === 'ORG_LAST_OWNER'
    ? 'Promote another owner before leaving or removing the last owner.'
    : error instanceof IdentityClientError &&
        error.code === 'AUTH_REAUTH_REQUIRED'
      ? 'Confirm your identity in account security, then try again.'
      : error instanceof IdentityClientError && error.status === 503
        ? 'Service temporarily unavailable. Please try again.'
        : 'Unable to complete this action. Refresh and check your access.';
}
export function QueryFailure({ error }: { error: unknown }) {
  if (error instanceof IdentityClientError && error.status === 403)
    return (
      <>
        <ErrorState message={identityMessage(error)} />
        <nav
          className="flex flex-wrap gap-2 px-6 pb-6"
          aria-label="Access options"
        >
          <a href="/two-factor?returnTo=%2Fworkspace">Verify your sign-in</a>
          <a href="/account/security">Account security</a>
          <a href="/workspace">Return to workspace</a>
        </nav>
      </>
    );
  return (
    <SessionBoundary
      embedded
      state={
        error instanceof IdentityClientError && error.status === 401
          ? 'expired'
          : 'unavailable'
      }
    >
      {null}
    </SessionBoundary>
  );
}
export function useCursorPage<T>(
  key: readonly unknown[],
  load: (cursor?: string) => Promise<Page<T>>,
  enabled = true,
) {
  const [cursor, setCursor] = useState<string | undefined>();
  const query = useQuery({
    queryKey: [...key, cursor ?? 'start'],
    queryFn: () => load(cursor),
    enabled,
    retry: false,
  });
  return {
    query,
    pagination: (
      <div className="flex gap-2">
        {cursor ? (
          <Button variant="outline" onClick={() => setCursor(undefined)}>
            First page
          </Button>
        ) : null}
        {query.data?.pageInfo.nextCursor ? (
          <Button
            variant="outline"
            onClick={() => setCursor(query.data!.pageInfo.nextCursor!)}
          >
            Next page
          </Button>
        ) : null}
      </div>
    ),
  };
}

'use client';
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { Page } from '@lexon/contracts';
import {
  createIdentityClient,
  IdentityClientError,
  SLUG_TAKEN_MESSAGE,
} from '../../lib/identity-client';
import { SessionBoundary } from '../auth/session-boundary';
import { Button } from '../ui/button';
import { ErrorState } from '../states/page-states';
import { ListFailure } from '../states/list-failure';
export const identityApi = createIdentityClient({ baseUrl: '/api' });
export function identityMessage(error: unknown): string {
  return error instanceof IdentityClientError && error.code === 'ORG_SLUG_TAKEN'
    ? SLUG_TAKEN_MESSAGE
    : error instanceof IdentityClientError && error.code === 'ORG_LAST_OWNER'
      ? 'Promote another owner before leaving or removing the last owner.'
      : error instanceof IdentityClientError &&
          error.code === 'AUTH_REAUTH_REQUIRED'
        ? 'Confirm your identity in account security, then try again.'
        : error instanceof IdentityClientError && error.status === 503
          ? 'Service temporarily unavailable. Please try again.'
          : 'Unable to complete this action. Refresh and check your access.';
}
export function QueryFailure({
  error,
  list,
}: {
  error: unknown;
  /** A list that failed to load: show the error row with Try again. */
  list?: { thing: string; onRetry: () => void };
}) {
  if (error instanceof IdentityClientError && error.status === 403)
    return (
      <>
        <ErrorState message={identityMessage(error)} />
        <nav
          className="flex flex-wrap gap-2 px-6 pb-6"
          aria-label="Access options"
        >
          <a href="/two-factor?returnTo=%2Fworkspace%3Fsettings%3Dsecurity">
            Verify your sign-in
          </a>
          <a href="/workspace?settings=security">Account security</a>
          <a href="/workspace">Return to workspace</a>
        </nav>
      </>
    );
  if (list && !(error instanceof IdentityClientError && error.status === 401))
    return <ListFailure thing={list.thing} onRetry={list.onRetry} />;
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
/**
 * The form alert for a failed save: the draft is still on screen, so say so.
 * A failure that needs a specific action (confirm identity) keeps its own text.
 */
export function saveFailureMessage(thing: string, error: unknown): string {
  return error instanceof IdentityClientError &&
    error.code === 'AUTH_REAUTH_REQUIRED'
    ? identityMessage(error)
    : `We could not save ${thing}. Your changes are still here. Try again.`;
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
  const firstPage = () => setCursor(undefined);
  const nextPage = () => {
    const nextCursor = query.data?.pageInfo.nextCursor;
    if (nextCursor) setCursor(nextCursor);
  };
  return {
    query,
    canGoToFirstPage: cursor !== undefined,
    canGoToNextPage: Boolean(query.data?.pageInfo.nextCursor),
    firstPage,
    nextPage,
    pagination: (
      <div className="flex gap-2">
        {cursor !== undefined ? (
          <Button variant="outline" onClick={firstPage}>
            First page
          </Button>
        ) : null}
        {query.data?.pageInfo.nextCursor ? (
          <Button variant="outline" onClick={nextPage}>
            Next page
          </Button>
        ) : null}
      </div>
    ),
  };
}

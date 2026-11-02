'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { safeReturnPath } from '../../lib/return-path';
import { authClient } from '../../lib/auth-client';
import { Button } from '../ui/button';
export function SessionBoundary({
  state,
  children,
  embedded = false,
  onRetry,
}: {
  state: 'authenticated' | 'expired' | 'unavailable';
  children: ReactNode;
  embedded?: boolean;
  onRetry?: () => Promise<unknown>;
}) {
  const [failed, setFailed] = useState(false);
  const [signInHref, setSignInHref] = useState(
    '/sign-in?returnTo=%2Fworkspace',
  );
  useEffect(() => {
    setSignInHref(
      '/sign-in?returnTo=' +
        encodeURIComponent(
          safeReturnPath(window.location.pathname + window.location.search),
        ),
    );
    if (state !== 'expired') return;
    let active = true;
    void authClient
      .signOut()
      .then((result) => {
        if (!active) return;
        if (result.error) {
          setFailed(true);
          return;
        }
        window.location.replace(
          '/sign-in?returnTo=' +
            encodeURIComponent(
              safeReturnPath(window.location.pathname + window.location.search),
            ),
        );
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [state]);
  if (state === 'authenticated') return children;
  const content = (
    <>
      <p>
        {state === 'unavailable' || failed
          ? 'Service temporarily unavailable. Please try again.'
          : 'Your session has expired. Signing out…'}
      </p>
      {state === 'expired' ? <a href={signInHref}>Sign in again</a> : null}
    </>
  );
  if (embedded) {
    return (
      <section
        className="mx-auto flex max-w-md flex-col gap-2 p-6"
        role="status"
        aria-live="polite"
      >
        {content}
        {state === 'unavailable' && onRetry ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => void onRetry().catch(() => {})}
          >
            Retry
          </Button>
        ) : null}
      </section>
    );
  }
  return (
    <main className="mx-auto max-w-md p-6" role="status">
      {content}
    </main>
  );
}

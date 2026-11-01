'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { safeReturnPath } from '../../lib/return-path';
import { authClient } from '../../lib/auth-client';
export function SessionBoundary({
  state,
  children,
  embedded = false,
}: {
  state: 'authenticated' | 'expired' | 'unavailable';
  children: ReactNode;
  embedded?: boolean;
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
        className="mx-auto max-w-md space-y-3 p-6"
        role="status"
        aria-live="polite"
      >
        {content}
      </section>
    );
  }
  return (
    <main className="mx-auto max-w-md p-6" role="status">
      {content}
    </main>
  );
}

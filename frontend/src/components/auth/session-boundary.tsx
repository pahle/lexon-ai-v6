'use client';
import { useEffect, useState, type ReactNode } from 'react';
import { safeReturnPath } from '../../lib/return-path';
import { authClient } from '../../lib/auth-client';
export function SessionBoundary({
  state,
  children,
}: {
  state: 'authenticated' | 'expired' | 'unavailable';
  children: ReactNode;
}) {
  const [failed, setFailed] = useState(false);
  useEffect(() => {
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
  return (
    <main className="mx-auto max-w-md p-6" role="status">
      {state === 'unavailable' || failed
        ? 'Service temporarily unavailable. Please try again.'
        : 'Your session has expired. Signing out…'}
    </main>
  );
}

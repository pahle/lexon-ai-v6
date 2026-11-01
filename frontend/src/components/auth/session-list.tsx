'use client';
import { useState } from 'react';
import type { OwnSessionSummary, Uuid } from '@lexon/contracts';
import { AuthCard } from './auth-card';
import { Button } from '../ui/button';
import { FieldError } from '../ui/field';
export function SessionList({
  sessions,
  onRevoke,
}: {
  sessions: readonly OwnSessionSummary[];
  onRevoke: (id: Uuid) => Promise<void>;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [failure, setFailure] = useState(false);
  return (
    <AuthCard
      title="Your sessions"
      description="Revoke access for a browser or add-in session."
    >
      <ul>
        {sessions.map((session) => (
          <li key={session.id} className="flex flex-col gap-2 py-3">
            <strong>
              {session.channel === 'cookie' ? 'Browser' : 'Bearer'}
            </strong>
            <span>
              {session.current ? 'Current session. ' : ''}Expires{' '}
              {new Date(session.expiresAt).toLocaleString('en')}
            </span>
            <Button
              variant="outline"
              disabled={busy !== null}
              onClick={async () => {
                setBusy(session.id);
                setFailure(false);
                try {
                  await onRevoke(session.id);
                } catch {
                  setFailure(true);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Revoke {session.channel === 'cookie' ? 'browser' : 'Bearer'}{' '}
              session
            </Button>
          </li>
        ))}
      </ul>
      {failure ? (
        <FieldError>Unable to revoke the session. Please try again.</FieldError>
      ) : null}
    </AuthCard>
  );
}

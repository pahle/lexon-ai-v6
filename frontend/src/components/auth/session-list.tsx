'use client';

import { useState } from 'react';
import type { OwnSessionSummary, Uuid } from '@lexon/contracts';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { EmptyState } from '../states/page-states';
import { PendingButton } from '../forms/pending-button';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { dateTimeFormatter } from '../../lib/date-time';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '../ui/alert-dialog';

export function SessionList({
  sessions,
  loading = false,
  onRevoke,
  onSignOutOthers,
}: {
  sessions: readonly OwnSessionSummary[];
  loading?: boolean;
  onRevoke: (id: Uuid) => Promise<void>;
  onSignOutOthers?: () => void;
}) {
  const [busy, setBusy] = useState<string | null>(null);
  const [revokeFailure, setRevokeFailure] = useState(false);
  const [confirmingId, setConfirmingId] = useState<Uuid | null>(null);
  const confirming = sessions.find((session) => session.id === confirmingId);
  const hasOtherSessions = sessions.some((session) => !session.current);
  const orderedSessions = [...sessions].sort(
    (first, second) => Number(second.current) - Number(first.current),
  );

  return (
    <section
      aria-labelledby="sessions-heading"
      className="flex min-w-0 flex-col gap-3"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="sessions-heading" className="text-sm font-medium">
          Where you are signed in
        </h3>
        {hasOtherSessions && onSignOutOthers ? (
          <Button variant="outline" onClick={onSignOutOthers}>
            Sign out other sessions
          </Button>
        ) : null}
      </div>
      {loading ? (
        <div
          role="status"
          aria-label="Loading sessions"
          className="flex flex-col gap-3 py-2"
        >
          <Skeleton className="h-8 w-full" />
          <Skeleton className="h-10 w-full" />
          <Skeleton className="h-10 w-full" />
        </div>
      ) : sessions.length === 0 ? (
        <EmptyState
          headingLevel={3}
          title="No active sessions"
          description="You are not signed in on any other browsers or devices."
        />
      ) : (
        <div className="min-w-0 overflow-x-auto rounded-[var(--radius)] border border-border">
          <table
            aria-label="Signed-in sessions"
            className="w-full border-collapse text-left text-sm"
          >
            <thead className="bg-[var(--surface-raised)] text-muted-foreground">
              <tr>
                <th scope="col" className="px-3 py-2 font-medium">
                  Session
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Signed in
                </th>
                <th scope="col" className="px-3 py-2 font-medium">
                  Expires
                </th>
                <th scope="col" className="px-3 py-2">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody>
              {orderedSessions.map((session) => (
                <tr key={session.id} className="border-t border-border">
                  <th scope="row" className="px-3 py-3 font-medium">
                    <span>
                      {session.channel === 'cookie' ? 'Browser' : 'Bearer'}
                    </span>
                    {session.current ? (
                      <Badge variant="secondary" className="ml-2">
                        Current
                      </Badge>
                    ) : null}
                  </th>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                    {dateTimeFormatter.format(new Date(session.createdAt))}
                  </td>
                  <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                    {dateTimeFormatter.format(new Date(session.expiresAt))}
                  </td>
                  <td className="px-3 py-3 text-right">
                    {!session.current ? (
                      <Button
                        variant="destructive"
                        disabled={busy !== null}
                        onClick={() => setConfirmingId(session.id)}
                      >
                        Revoke
                        <span className="sr-only">
                          {' '}
                          {session.channel === 'cookie'
                            ? 'browser'
                            : 'Bearer'}{' '}
                          session
                        </span>
                      </Button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <AlertDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) setConfirmingId(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Revoke this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This session will lose access to your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeFailure ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Unable to revoke the session</AlertTitle>
              <AlertDescription>Please try again.</AlertDescription>
            </Alert>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy !== null}>
              Cancel
            </AlertDialogCancel>
            <AlertDialogAction
              render={
                <PendingButton
                  pending={busy !== null}
                  pendingLabel="Revoking session…"
                >
                  Revoke session
                </PendingButton>
              }
              disabled={busy !== null}
              onClick={async (event) => {
                event.preventDefault();
                if (!confirming) return;
                setBusy(confirming.id);
                setRevokeFailure(false);
                try {
                  await onRevoke(confirming.id);
                  setConfirmingId(null);
                } catch {
                  setRevokeFailure(true);
                } finally {
                  setBusy(null);
                }
              }}
            >
              Revoke session
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

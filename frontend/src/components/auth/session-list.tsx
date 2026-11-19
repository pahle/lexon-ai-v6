'use client';

import { useState } from 'react';
import type { OwnSessionSummary, Uuid } from '@lexon/contracts';
import { Button } from '../ui/button';
import { Badge } from '../ui/badge';
import { Skeleton } from '../ui/skeleton';
import { ListFailure } from '../states/list-failure';
import { EmptyState } from '../states/page-states';
import { PendingButton } from '../forms/pending-button';
import { Alert, AlertDescription, AlertTitle } from '../ui/alert';
import { Monitor, Smartphone, Tablet } from 'lucide-react';
import { formatRelativeTime } from '../../lib/relative-time';
import {
  settingsDescriptionClass,
  settingsLabelClass,
  settingsRowClass,
} from '../settings/settings-section';
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

const deviceIcons = {
  desktop: Monitor,
  mobile: Smartphone,
  tablet: Tablet,
  unknown: Monitor,
} as const;

export function SessionList({
  sessions,
  loading = false,
  failed = false,
  onRetry,
  onRevoke,
  onSignOutOthers,
}: {
  sessions: readonly OwnSessionSummary[];
  loading?: boolean;
  failed?: boolean;
  onRetry?: () => void;
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
      className="flex min-w-0 flex-col"
    >
      <div className="flex flex-wrap items-center justify-between gap-3 pt-5">
        <h3
          id="sessions-heading"
          className="text-sm leading-[normal] font-semibold"
        >
          Where you are signed in
        </h3>
        {hasOtherSessions && onSignOutOthers ? (
          <Button variant="outline" onClick={onSignOutOthers}>
            Sign out other sessions
          </Button>
        ) : null}
      </div>
      {failed && onRetry ? (
        <ListFailure thing="sessions" onRetry={onRetry} />
      ) : loading ? (
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
        <ul aria-label="Signed-in sessions" className="flex flex-col">
          {orderedSessions.map((session) => {
            const DeviceIcon = deviceIcons[session.deviceKind];
            return (
              <li
                key={session.id}
                data-slot="session-row"
                className={settingsRowClass(true)}
              >
                <div className="flex min-w-0 items-center gap-3">
                  <span
                    data-slot="device-tile"
                    aria-hidden="true"
                    className="flex size-9 shrink-0 items-center justify-center rounded-[10px] bg-muted text-foreground"
                  >
                    <DeviceIcon className="size-[18px]" />
                  </span>
                  <div className="min-w-0">
                    <div className={settingsLabelClass}>
                      {session.deviceName}
                      {session.current ? (
                        <Badge variant="outline" className="ml-1 border-input">
                          This device
                        </Badge>
                      ) : null}
                    </div>
                    <div className={settingsDescriptionClass}>
                      {session.current
                        ? 'Active now'
                        : `Signed in ${formatRelativeTime(session.createdAt)}`}
                    </div>
                  </div>
                </div>
                {!session.current ? (
                  <Button
                    variant="outline"
                    disabled={busy !== null}
                    aria-label={`Sign out ${session.deviceName}`}
                    onClick={() => {
                      setRevokeFailure(false);
                      setConfirmingId(session.id);
                    }}
                  >
                    Sign out
                  </Button>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
      <AlertDialog
        open={confirming !== undefined}
        onOpenChange={(open) => {
          if (!open) {
            setRevokeFailure(false);
            setConfirmingId(null);
          }
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Sign out this session?</AlertDialogTitle>
            <AlertDialogDescription>
              This session will lose access to your account.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {revokeFailure ? (
            <Alert role="alert" variant="destructive">
              <AlertTitle>Unable to sign out the session</AlertTitle>
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
                  pendingLabel="Signing out…"
                >
                  Sign out
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
              Sign out
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  );
}

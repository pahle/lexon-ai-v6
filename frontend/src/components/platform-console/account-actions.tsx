'use client';

import { useQueryClient } from '@tanstack/react-query';
import { BanIcon, LogOutIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import { ConfirmDialog } from '../data-views';
import { identityMessage } from '../organizations/page-state';
import { PlatformApiError, platformConsoleApi } from './api';
import { COUNT_KEYS } from './invite-dialog';

/** The account an action applies to (a list row or a record). */
export type AccountTarget = {
  id: string;
  name: string;
  email: string;
};

export function actionMessage(error: unknown): string {
  const code = error instanceof PlatformApiError ? error.code : '';
  if (code === 'AUTH_RATE_LIMITED')
    return 'Too many requests. Wait a moment and try again.';
  if (code === 'PLATFORM_SELF_ACTION')
    return 'You cannot do that to your own account.';
  if (code === 'PLATFORM_LAST_ADMINISTRATOR')
    return 'This is the last platform administrator. Make another account an administrator first.';
  if (code === 'PLATFORM_ALREADY_VERIFIED')
    return 'This email address is already verified.';
  if (error instanceof PlatformApiError && error.status === 404)
    return 'This account no longer exists.';
  return identityMessage(error);
}

/**
 * Account actions shared by the account record and the Accounts row menu:
 * the confirmations for Disable and Sign out everywhere, Enable without one,
 * and the same toasts. Every outcome refreshes the record, the lists, and
 * the tab counts.
 */
export function useAccountActions() {
  const queryClient = useQueryClient();
  const [confirm, setConfirm] = useState<{
    kind: 'disable' | 'signout';
    target: AccountTarget;
  } | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);

  async function run(
    target: AccountTarget,
    action: () => Promise<void>,
    success: string,
  ) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(actionMessage(error));
    } finally {
      // Refresh whatever the outcome: the account may have changed under us.
      await queryClient.invalidateQueries({
        queryKey: ['platform', 'account', target.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['platform', 'accounts'],
      });
      void queryClient.invalidateQueries({ queryKey: COUNT_KEYS.accounts });
      setBusy(false);
      setOpen(false);
    }
  }

  const ask = (kind: 'disable' | 'signout', target: AccountTarget) => {
    setConfirm({ kind, target });
    setOpen(true);
  };
  const enable = (target: AccountTarget) =>
    run(
      target,
      () => platformConsoleApi.setDisabled(target.id, false),
      'Account enabled.',
    );
  const sendVerification = (target: AccountTarget) =>
    run(
      target,
      () => platformConsoleApi.sendVerification(target.id),
      `Verification email sent to ${target.email}.`,
    );

  // The target is kept after closing so the copy does not change while the
  // dialog animates out.
  const target = confirm?.target;
  const dialogs = (
    <>
      <ConfirmDialog
        open={open && confirm?.kind === 'disable'}
        onOpenChange={(next) => !next && setOpen(false)}
        title={`Disable ${target?.name ?? ''}?`}
        description="They are signed out everywhere and cannot sign in. Their teams and content stay unchanged. You can enable the account again."
        confirmLabel="Disable account"
        icon={BanIcon}
        destructive
        pending={busy}
        onConfirm={() =>
          target &&
          void run(
            target,
            () => platformConsoleApi.setDisabled(target.id, true),
            'Account disabled.',
          )
        }
      />
      <ConfirmDialog
        open={open && confirm?.kind === 'signout'}
        onOpenChange={(next) => !next && setOpen(false)}
        title={`Sign ${target?.name ?? ''} out everywhere?`}
        description="All their active sessions end. They can sign in again."
        confirmLabel="Sign out everywhere"
        icon={LogOutIcon}
        pending={busy}
        onConfirm={() =>
          target &&
          void run(
            target,
            () => platformConsoleApi.revokeSessions(target.id),
            `${target.name} was signed out everywhere.`,
          )
        }
      />
    </>
  );

  return { busy, ask, enable, sendVerification, dialogs };
}

'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  BanIcon,
  CalendarIcon,
  CircleCheckIcon,
  ClockIcon,
  KeyRoundIcon,
  LogOutIcon,
  MailIcon,
  ShieldCheckIcon,
  UsersIcon,
} from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { PlatformAccountDetail } from '@lexon/contracts';
import {
  ConfirmDialog,
  DetailsCard,
  IdentityCell,
  OpenCell,
  RecordHeader,
  RecordPage,
  RelatedTable,
  StatTiles,
  StatusBadge,
  TagCell,
  type DataColumn,
} from '../data-views';
import { identityMessage } from '../organizations/page-state';
import { ListFailure } from '../states/list-failure';
import { useWorkspace } from '../shell/workspace-provider';
import { formatPlatformDate } from '../platform/platform-format';
import { Button } from '../ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { PlatformApiError, platformConsoleApi } from './api';
import { COUNT_KEYS } from './invite-dialog';

const tone = {
  active: 'neutral',
  unverified: 'warning',
  disabled: 'inactive',
} as const;
const cap = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

function actionMessage(error: unknown): string {
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

const teamColumns: DataColumn<PlatformAccountDetail['teams'][number]>[] = [
  {
    key: 'organization',
    header: 'Organization',
    cell: (t) => (
      <IdentityCell
        shape="organization"
        name={t.name}
        secondary={t.slug}
        initials={initials(t.name)}
      />
    ),
  },
  {
    key: 'role',
    header: 'Role',
    width: '110px',
    cell: (t) => <TagCell>{cap(t.role)}</TagCell>,
  },
  {
    key: 'open',
    header: 'Open',
    hideHeader: true,
    width: '56px',
    cell: (t) => (
      <OpenCell
        label={t.name}
        href={`/platform/organizations/${t.organizationId}`}
      />
    ),
  },
];

function Body({ account }: { account: PlatformAccountDetail }) {
  const queryClient = useQueryClient();
  const { identity } = useWorkspace();
  // Unknown identity is treated as self: no account action until we know.
  const isSelf = !identity || identity.user.id === account.id;
  const [confirm, setConfirm] = useState<'disable' | 'signout' | null>(null);
  const [busy, setBusy] = useState(false);

  async function run(action: () => Promise<void>, success: string) {
    setBusy(true);
    try {
      await action();
      toast.success(success);
    } catch (error) {
      toast.error(actionMessage(error));
    } finally {
      // Refresh whatever the outcome: the account may have changed under us.
      await queryClient.invalidateQueries({
        queryKey: ['platform', 'account', account.id],
      });
      void queryClient.invalidateQueries({
        queryKey: ['platform', 'accounts'],
      });
      void queryClient.invalidateQueries({ queryKey: COUNT_KEYS.accounts });
      setBusy(false);
      setConfirm(null);
    }
  }

  const actions =
    account.status === 'disabled' ? (
      <Button
        type="button"
        disabled={busy}
        onClick={() =>
          void run(
            () => platformConsoleApi.setDisabled(account.id, false),
            'Account enabled.',
          )
        }
      >
        <CircleCheckIcon aria-hidden="true" />
        Enable account
      </Button>
    ) : isSelf ? null : (
      <>
        {account.status === 'unverified' ? (
          <Button
            type="button"
            disabled={busy}
            onClick={() =>
              void run(
                () => platformConsoleApi.sendVerification(account.id),
                `Verification email sent to ${account.email}.`,
              )
            }
          >
            <MailIcon aria-hidden="true" />
            Resend verification email
          </Button>
        ) : (
          <Button type="button" onClick={() => setConfirm('signout')}>
            <LogOutIcon aria-hidden="true" />
            Sign out everywhere
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          onClick={() => setConfirm('disable')}
        >
          <BanIcon aria-hidden="true" />
          Disable account
        </Button>
      </>
    );

  return (
    <RecordPage>
      <RecordHeader
        backHref="/platform/accounts"
        backLabel="Accounts"
        initials={initials(account.name)}
        title={account.name}
        badges={
          <>
            <StatusBadge tone={tone[account.status]}>
              {cap(account.status)}
            </StatusBadge>
            {account.isPlatformAdministrator ? (
              <StatusBadge>Platform administrator</StatusBadge>
            ) : null}
          </>
        }
        meta={[
          { icon: MailIcon, text: account.email },
          {
            icon: CalendarIcon,
            text: `Joined ${formatPlatformDate(account.createdAt)}`,
          },
          {
            icon: ClockIcon,
            text: account.lastActiveAt
              ? `Last active ${formatPlatformDate(account.lastActiveAt)}`
              : 'Last active never',
          },
        ]}
        actions={actions}
      />
      <div className="grid gap-4 md:gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="flex min-w-0 flex-col gap-4 md:gap-5">
          <StatTiles
            items={[
              {
                icon: UsersIcon,
                label: 'Teams',
                value: String(account.teamCount),
              },
              {
                icon: KeyRoundIcon,
                label: 'Active sessions',
                value: String(account.activeSessionCount),
                ...(account.status === 'disabled'
                  ? { supporting: 'Signed out when disabled' }
                  : {}),
              },
              {
                icon: ShieldCheckIcon,
                label: 'Two-step verification',
                value: account.twoFactorEnabled ? 'On' : 'Off',
              },
            ]}
          />
          <RelatedTable
            title="Teams"
            description="Team organizations this account belongs to."
            columns={teamColumns}
            rows={account.teams}
            getRowId={(t) => t.organizationId}
            status={account.teams.length ? 'ready' : 'empty'}
            onRetry={() => undefined}
            emptyTitle="No teams yet"
            emptyText="This account is not a member of any team."
          />
        </div>
        <DetailsCard
          rows={[
            { label: 'Email', value: account.email },
            {
              label: 'Email verified',
              value: account.emailVerified ? (
                'Yes'
              ) : (
                <StatusBadge tone="warning">No</StatusBadge>
              ),
            },
            {
              label: 'Signed up',
              value: formatPlatformDate(account.createdAt),
            },
            {
              label: 'Last active',
              value: account.lastActiveAt
                ? formatPlatformDate(account.lastActiveAt)
                : 'Never',
            },
            { label: 'Account ID', value: account.id, copy: true },
          ]}
        />
      </div>
      <ConfirmDialog
        open={confirm === 'disable'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Disable ${account.name}?`}
        description="They are signed out everywhere and cannot sign in. Their teams and content stay unchanged. You can enable the account again."
        confirmLabel="Disable account"
        icon={BanIcon}
        destructive
        pending={busy}
        onConfirm={() =>
          void run(
            () => platformConsoleApi.setDisabled(account.id, true),
            'Account disabled.',
          )
        }
      />
      <ConfirmDialog
        open={confirm === 'signout'}
        onOpenChange={(open) => !open && setConfirm(null)}
        title={`Sign ${account.name} out everywhere?`}
        description="All their active sessions end. They can sign in again."
        confirmLabel="Sign out everywhere"
        icon={LogOutIcon}
        pending={busy}
        onConfirm={() =>
          void run(
            () => platformConsoleApi.revokeSessions(account.id),
            `${account.name} was signed out everywhere.`,
          )
        }
      />
    </RecordPage>
  );
}

/** One account: header with actions, stat tiles, teams, details. */
export function AccountRecord({ userId }: { userId: string }) {
  const query = useQuery({
    queryKey: ['platform', 'account', userId],
    queryFn: () => platformConsoleApi.account(userId),
    retry: false,
  });
  if (query.isPending)
    return (
      <RecordPage>
        <div role="status" aria-busy="true" aria-label="Loading account">
          <Skeleton className="h-14 w-72" />
          <Skeleton className="mt-6 h-24 w-full" />
        </div>
      </RecordPage>
    );
  if (query.error instanceof PlatformApiError && query.error.status === 404)
    return (
      <RecordPage>
        <Empty>
          <EmptyHeader>
            <EmptyTitle>Account not found</EmptyTitle>
            <EmptyDescription>
              It may have been removed, or the link is wrong.{' '}
              <a href="/platform/accounts" className="underline">
                Back to accounts
              </a>
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </RecordPage>
    );
  if (query.isError)
    return (
      <RecordPage>
        <ListFailure
          thing="this account"
          onRetry={() => void query.refetch()}
        />
      </RecordPage>
    );
  return <Body account={query.data} />;
}

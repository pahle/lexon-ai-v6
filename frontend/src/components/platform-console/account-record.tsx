'use client';

import { useQuery } from '@tanstack/react-query';
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
import type { PlatformAccountDetail } from '@lexon/contracts';
import {
  DetailsCard,
  IdentityAvatar,
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
import { ListFailure } from '../states/list-failure';
import { useWorkspace } from '../shell/workspace-provider';
import { LastActive } from '../platform/last-active';
import {
  formatLastActiveHeader,
  formatPlatformDate,
  formatPlatformDateTime,
} from '../platform/platform-format';
import { Button } from '../ui/button';
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '../ui/empty';
import { Skeleton } from '../ui/skeleton';
import { PlatformApiError, platformConsoleApi } from './api';
import { useAccountActions } from './account-actions';

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
  const { identity } = useWorkspace();
  // Unknown identity is treated as self: no account action until we know.
  const isSelf = !identity || identity.user.id === account.id;
  const { busy, ask, enable, sendVerification, dialogs } = useAccountActions();

  const actions =
    account.status === 'disabled' ? (
      <Button
        type="button"
        variant="outline"
        disabled={busy}
        onClick={() => void enable(account)}
      >
        <CircleCheckIcon aria-hidden="true" />
        Enable account
      </Button>
    ) : isSelf ? null : (
      <>
        {account.status === 'unverified' ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void sendVerification(account)}
          >
            <MailIcon aria-hidden="true" />
            Resend verification email
          </Button>
        ) : (
          <Button
            type="button"
            variant="outline"
            onClick={() => ask('signout', account)}
          >
            <LogOutIcon aria-hidden="true" />
            Sign out everywhere
          </Button>
        )}
        <Button
          type="button"
          variant="outline"
          className="text-lexon-red-text"
          onClick={() => ask('disable', account)}
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
            text: formatLastActiveHeader(account.lastActiveAt),
            ...(account.lastActiveAt
              ? { title: formatPlatformDateTime(account.lastActiveAt) }
              : {}),
          },
        ]}
        actions={actions}
      />
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
            value: <LastActive value={account.lastActiveAt} />,
          },
          { label: 'Account ID', value: account.id, copy: true },
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
        mobileRow={(t) => ({
          lead: (
            <IdentityAvatar shape="organization" initials={initials(t.name)} />
          ),
          title: t.name,
          sub: t.slug,
          badge: <TagCell>{cap(t.role)}</TagCell>,
          trailing: (
            <OpenCell
              label={t.name}
              href={`/platform/organizations/${t.organizationId}`}
            />
          ),
        })}
      />
      {dialogs}
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

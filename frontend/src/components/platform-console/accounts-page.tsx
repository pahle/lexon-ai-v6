'use client';

import { useQuery } from '@tanstack/react-query';
import { EyeIcon, UserPlusIcon } from 'lucide-react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useState } from 'react';
import type { PlatformAccountSummary } from '@lexon/contracts';
import {
  DataListPage,
  DataStates,
  DataTable,
  DataTableCard,
  DataToolbar,
  FacetFilter,
  IdentityCell,
  MutedCell,
  OnOffDot,
  PagedFooter,
  RowMenu,
  StatusBadge,
  useDataViewParams,
  type DataColumn,
} from '../data-views';
import { QueryFailure } from '../organizations/page-state';
import { PlatformApiError, platformConsoleApi } from './api';
import { InvitationsTab } from './invitations-tab';
import { InviteDialog } from './invite-dialog';
import { Button } from '../ui/button';
import { formatPlatformDate } from '../platform/platform-format';

const STATUS = [
  { value: 'active', label: 'Active' },
  { value: 'unverified', label: 'Unverified' },
  { value: 'disabled', label: 'Disabled' },
];
const TWO_STEP = [
  { value: 'on', label: 'On' },
  { value: 'off', label: 'Off' },
];
const tone = {
  active: 'neutral',
  unverified: 'warning',
  disabled: 'inactive',
} as const;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** Everyone with a Lexon account, and the people invited to create one. */
export function AccountsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const tab =
    useSearchParams().get('tab') === 'invitations' ? 'invitations' : 'accounts';
  const [inviting, setInviting] = useState(false);
  return (
    <DataListPage
      title="Accounts"
      description="Everyone with a Lexon account, and the people you invited to create one."
      action={
        <Button type="button" onClick={() => setInviting(true)}>
          <UserPlusIcon aria-hidden="true" />
          Invite account
        </Button>
      }
      tabs={[
        { value: 'accounts', label: 'Accounts' },
        { value: 'invitations', label: 'Invitations' },
      ]}
      tab={tab}
      onTab={(value) =>
        router.replace(
          value === 'invitations' ? `${pathname}?tab=invitations` : pathname,
        )
      }
    >
      {tab === 'invitations' ? <InvitationsTab /> : <AccountsTab />}
      <InviteDialog open={inviting} onOpenChange={setInviting} />
    </DataListPage>
  );
}

export function AccountsTab() {
  const router = useRouter();
  const view = useDataViewParams(['status', 'twoFactor']);
  const status = view.facets.status ?? [];
  const twoFactor = view.facets.twoFactor ?? [];
  const list = useQuery({
    queryKey: [
      'platform',
      'accounts',
      view.query,
      status,
      twoFactor,
      view.page,
      view.pageSize,
    ],
    queryFn: () =>
      platformConsoleApi.listAccounts({
        query: view.query,
        status,
        twoFactor,
        page: view.page,
        pageSize: view.pageSize,
      }),
    retry: false,
  });
  const filtered = Boolean(view.query || status.length || twoFactor.length);
  const rows = list.data?.items ?? [];
  const state = list.isPending
    ? 'loading'
    : list.isError
      ? 'error'
      : rows.length
        ? 'ready'
        : filtered
          ? 'no-results'
          : 'empty';
  const open = (row: PlatformAccountSummary) =>
    router.push(`/platform/accounts/${row.id}`);

  const columns: DataColumn<PlatformAccountSummary>[] = [
    {
      key: 'account',
      header: 'Account',
      cell: (a) => (
        <IdentityCell
          name={a.name}
          secondary={a.email}
          initials={initials(a.name)}
          badge={
            a.isPlatformAdministrator ? (
              <StatusBadge>Platform administrator</StatusBadge>
            ) : undefined
          }
        />
      ),
    },
    {
      key: 'status',
      header: 'Status',
      width: '124px',
      cell: (a) => (
        <StatusBadge tone={tone[a.status]}>
          {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
        </StatusBadge>
      ),
    },
    {
      key: 'twoFactor',
      header: 'Two-step',
      width: '100px',
      cell: (a) => <OnOffDot on={a.twoFactorEnabled} />,
    },
    {
      key: 'teams',
      header: 'Teams',
      width: '80px',
      numeric: true,
      cell: (a) => a.teamCount,
    },
    {
      key: 'joined',
      header: 'Joined',
      width: '124px',
      muted: true,
      cell: (a) => formatPlatformDate(a.createdAt),
    },
    {
      key: 'lastActive',
      header: 'Last active',
      width: '124px',
      muted: true,
      cell: (a) =>
        a.lastActiveAt ? formatPlatformDate(a.lastActiveAt) : 'Never',
    },
    {
      key: 'menu',
      header: 'Actions',
      hideHeader: true,
      width: '56px',
      cell: (a) => (
        <RowMenu
          label={`Actions for ${a.name}`}
          items={[
            { label: 'View account', icon: EyeIcon, onSelect: () => open(a) },
          ]}
        />
      ),
    },
  ];

  if (
    list.error instanceof PlatformApiError &&
    (list.error.status === 401 || list.error.status === 403)
  )
    return <QueryFailure error={list.error} />;

  const resetFilters = () =>
    view.set({ query: '', facets: { status: [], twoFactor: [] } });
  return (
    <DataTableCard
      toolbar={
        <DataToolbar
          query={view.query}
          onQuery={(query) => view.set({ query })}
          onReset={resetFilters}
          hasFilters={filtered}
          placeholder="Search by name or email"
          facets={
            <>
              <FacetFilter
                label="Status"
                options={STATUS}
                selected={status}
                onChange={(next) =>
                  view.set({ facets: { ...view.facets, status: next } })
                }
              />
              <FacetFilter
                label="Two-step"
                options={TWO_STEP}
                selected={twoFactor}
                onChange={(next) =>
                  view.set({ facets: { ...view.facets, twoFactor: next } })
                }
              />
            </>
          }
        />
      }
      footer={
        list.data ? (
          <PagedFooter
            page={view.page}
            pageSize={view.pageSize}
            total={list.data.total}
            noun="account"
            ready={!list.isFetching}
            onPage={(page) => view.set({ page })}
            onPageSize={(pageSize) => view.set({ pageSize })}
          />
        ) : null
      }
    >
      {rows.length && !list.isError ? (
        <DataTable
          columns={columns}
          rows={rows}
          getRowId={(a) => a.id}
          onOpen={open}
          openLabel={(a) => `Open ${a.name}`}
          sort={{ key: 'joined', direction: 'descending' }}
          mobileRow={(a) => ({
            lead: (
              <span className="bg-muted text-muted-foreground flex size-8 items-center justify-center rounded-full text-xs font-semibold">
                {initials(a.name)}
              </span>
            ),
            title: a.name,
            sub: a.email,
            badge: (
              <>
                <StatusBadge tone={tone[a.status]}>
                  {a.status.charAt(0).toUpperCase() + a.status.slice(1)}
                </StatusBadge>
                {a.isPlatformAdministrator ? (
                  <StatusBadge>Platform administrator</StatusBadge>
                ) : null}
              </>
            ),
            meta: (
              <MutedCell>
                {`Two-step ${a.twoFactorEnabled ? 'on' : 'off'} · ${a.teamCount} ${a.teamCount === 1 ? 'team' : 'teams'}`}
              </MutedCell>
            ),
          })}
        />
      ) : (
        <DataStates
          status={state}
          pageSize={view.pageSize}
          onRetry={() => void list.refetch()}
          onReset={resetFilters}
          query={view.query}
          thing="accounts"
          emptyTitle="No accounts yet"
          emptyText="Accounts appear here once people sign up or accept an invitation."
        />
      )}
    </DataTableCard>
  );
}

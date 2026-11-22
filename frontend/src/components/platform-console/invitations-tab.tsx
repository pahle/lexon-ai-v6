'use client';

import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BanIcon, MailIcon } from 'lucide-react';
import { useState } from 'react';
import { toast } from 'sonner';
import type { AccountInvitation } from '@lexon/contracts';
import {
  DataStates,
  DataTable,
  DataTableCard,
  DataToolbar,
  FacetFilter,
  IdentityCell,
  ConfirmDialog,
  MutedCell,
  PagedFooter,
  RowMenu,
  StatusBadge,
  useDataViewParams,
  type DataColumn,
} from '../data-views';
import { identityMessage, QueryFailure } from '../organizations/page-state';
import { formatPlatformDate } from '../platform/platform-format';
import { PlatformApiError, platformConsoleApi } from './api';
import { COUNT_KEYS, INVITATIONS_KEY } from './invite-dialog';

const STATUS = [
  { value: 'pending', label: 'Pending' },
  { value: 'expired', label: 'Expired' },
];

const statusBadge = (i: AccountInvitation) => (
  <StatusBadge tone={i.status === 'expired' ? 'warning' : 'neutral'}>
    {i.status === 'expired' ? 'Expired' : 'Pending'}
  </StatusBadge>
);

const columnsFor = (
  menu: (i: AccountInvitation) => React.ReactNode,
): DataColumn<AccountInvitation>[] => [
  {
    key: 'person',
    header: 'Invited person',
    cell: (i) => (
      <IdentityCell
        shape="invitation"
        name={i.name || i.email}
        secondary={i.name ? i.email : 'No name given'}
      />
    ),
  },
  {
    key: 'status',
    header: 'Status',
    width: '112px',
    cell: statusBadge,
  },
  {
    key: 'invitedBy',
    header: 'Invited by',
    width: '150px',
    muted: true,
    cell: (i) => i.invitedBy,
  },
  {
    key: 'sent',
    header: 'Sent',
    width: '120px',
    muted: true,
    cell: (i) => formatPlatformDate(i.sentAt),
  },
  {
    key: 'expires',
    header: 'Expires',
    width: '120px',
    muted: true,
    cell: (i) => formatPlatformDate(i.expiresAt),
  },
  {
    key: 'menu',
    header: 'Actions',
    hideHeader: true,
    width: '56px',
    cell: menu,
  },
];

export function InvitationsTab() {
  const queryClient = useQueryClient();
  const [cancelling, setCancelling] = useState<AccountInvitation | null>(null);
  const [busy, setBusy] = useState(false);
  const view = useDataViewParams(['status', 'tab']);
  const status = view.facets.status ?? [];
  const list = useQuery({
    queryKey: [
      ...INVITATIONS_KEY,
      view.query,
      status,
      view.page,
      view.pageSize,
    ],
    queryFn: () =>
      platformConsoleApi.listInvitations({
        query: view.query,
        status,
        page: view.page,
        pageSize: view.pageSize,
      }),
    retry: false,
  });
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: INVITATIONS_KEY }),
      queryClient.invalidateQueries({ queryKey: COUNT_KEYS.invitations }),
    ]);

  /** Runs an action; the list is refreshed when it succeeded or the invitation is gone. */
  async function act(action: () => Promise<void>, success: string) {
    try {
      await action();
      toast.success(success);
      await refresh();
    } catch (error) {
      const code = error instanceof PlatformApiError ? error.code : '';
      if (error instanceof PlatformApiError && error.status === 404) {
        toast.error('That invitation no longer exists.');
        await refresh();
      } else if (code === 'AUTH_RATE_LIMITED')
        toast.error('Too many requests. Wait a moment and try again.');
      else toast.error(identityMessage(error));
    }
  }

  const menuFor = (i: AccountInvitation) => (
    <RowMenu
      label={`Actions for ${i.email}`}
      items={[
        {
          label: 'Resend invitation',
          icon: MailIcon,
          onSelect: () =>
            void act(
              () => platformConsoleApi.resend(i.id),
              `Invitation resent to ${i.email}.`,
            ),
        },
        {
          label: 'Cancel invitation',
          icon: BanIcon,
          destructive: true,
          onSelect: () => setCancelling(i),
        },
      ]}
    />
  );
  const columns = columnsFor(menuFor);
  const filtered = Boolean(view.query || status.length);
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
  if (
    list.error instanceof PlatformApiError &&
    (list.error.status === 401 || list.error.status === 403)
  )
    return <QueryFailure error={list.error} />;
  // `tab` rides along as a facet key so filtering keeps the Invitations tab.
  const resetFilters = () => view.set({ query: '', facets: { status: [] } });
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
            <FacetFilter
              label="Status"
              options={STATUS}
              selected={status}
              onChange={(next) => view.set({ facets: { status: next } })}
            />
          }
        />
      }
      footer={
        list.data ? (
          <PagedFooter
            page={view.page}
            pageSize={view.pageSize}
            total={list.data.total}
            noun="invitation"
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
          getRowId={(i) => i.id}
          sort={{ key: 'sent', direction: 'descending' }}
          // The prototype's mobile invitation row; the menu stays at the
          // right (the row opens nothing, so the actions live there).
          mobileRow={(i) => ({
            lead: (
              <span
                aria-hidden="true"
                className="border-input text-muted-foreground flex size-8 flex-none items-center justify-center rounded-lg border border-dashed"
              >
                <MailIcon className="size-3.5" />
              </span>
            ),
            title: i.name || i.email,
            ...(i.name ? { sub: i.email } : {}),
            badge: statusBadge(i),
            meta: (
              <MutedCell>
                {`Sent ${formatPlatformDate(i.sentAt)} · Expires ${formatPlatformDate(i.expiresAt)}`}
              </MutedCell>
            ),
            trailing: menuFor(i),
          })}
        />
      ) : (
        <DataStates
          status={state}
          pageSize={view.pageSize}
          onRetry={() => void list.refetch()}
          onReset={resetFilters}
          query={view.query}
          thing="invitations"
          emptyTitle="No invitations"
          emptyText="Invite someone and they appear here until they create their account."
        />
      )}
      <ConfirmDialog
        open={cancelling !== null}
        onOpenChange={(open) => !open && setCancelling(null)}
        title={`Cancel the invitation to ${cancelling?.email ?? ''}?`}
        description="The link in the email stops working. You can invite them again later."
        confirmLabel="Cancel invitation"
        icon={BanIcon}
        destructive
        pending={busy}
        onConfirm={() => {
          const target = cancelling;
          if (!target) return;
          setBusy(true);
          void act(
            () => platformConsoleApi.cancel(target.id),
            `Invitation to ${target.email} canceled.`,
          ).finally(() => {
            setBusy(false);
            setCancelling(null);
          });
        }}
      />
    </DataTableCard>
  );
}

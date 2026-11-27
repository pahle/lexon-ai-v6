'use client';

import { useId, useState } from 'react';
import {
  useInfiniteQuery,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type {
  DenySummary,
  OrgMemberSummary,
  OrgProjectSummary,
} from '@lexon/contracts';
import type { MattersApi } from '@/lib/matters-api';
import type { ChatQueryScope } from '@/lib/chat-queries';
import { formatDayMonthYear } from '@/lib/date-time';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { ListFailure } from '@/components/states/list-failure';
import { Spinner } from '@/components/ui/spinner';

/**
 * F6 §10/§16 settings-matters: org owners/admins audit every matter in the
 * workspace — name metadata only, plus a Restricted count and the ethical-wall
 * management dialog. Instructions, member identities, and the caller's role
 * stay off this surface.
 */
export function SettingsMatters({
  client,
  scope,
}: {
  client: MattersApi;
  scope: ChatQueryScope;
}) {
  const [restrictTarget, setRestrictTarget] =
    useState<OrgProjectSummary | null>(null);
  const query = useInfiniteQuery({
    queryKey: ['org-matters', scope.orgId],
    initialPageParam: undefined as string | undefined,
    queryFn: ({ pageParam }) =>
      client.orgList({
        limit: 50,
        ...(pageParam ? { cursor: pageParam } : {}),
      }),
    getNextPageParam: (page) => page.nextCursor ?? undefined,
  });
  const items = query.data?.pages.flatMap((page) => page.items) ?? [];
  if (query.isPending)
    return (
      <div
        role="status"
        aria-label="Loading matters"
        className="flex flex-col gap-2.5"
      >
        {[0, 1, 2, 3].map((row) => (
          <Skeleton key={row} aria-hidden="true" className="h-9 w-full" />
        ))}
      </div>
    );
  if (query.isError)
    return <ListFailure thing="matters" onRetry={() => void query.refetch()} />;
  return (
    <div className="flex flex-col gap-3">
      <div className="border-border overflow-hidden rounded-xl border">
        <table className="w-full text-left text-sm">
          <thead>
            <tr className="border-border text-muted-foreground border-b text-xs">
              <th className="px-3.5 py-2.5 font-medium">Matter</th>
              <th className="px-3.5 py-2.5 font-medium max-md:hidden">
                Practice area
              </th>
              <th className="px-3.5 py-2.5 font-medium max-md:hidden">Owner</th>
              <th className="px-3.5 py-2.5 font-medium">Members</th>
              <th className="px-3.5 py-2.5 font-medium">Restricted</th>
              <th className="px-3.5 py-2.5" aria-label="Actions" />
            </tr>
          </thead>
          <tbody className="divide-border divide-y">
            {items.map((item) => (
              <tr key={item.id}>
                <td className="px-3.5 py-2.5">
                  <span className="block font-medium">{item.name}</span>
                  <span className="text-muted-foreground block text-xs">
                    {item.matterNumber}
                  </span>
                </td>
                <td className="text-muted-foreground px-3.5 py-2.5 max-md:hidden">
                  {item.practiceArea}
                </td>
                <td className="text-muted-foreground px-3.5 py-2.5 max-md:hidden">
                  {item.owner.name}
                </td>
                <td className="text-muted-foreground px-3.5 py-2.5">
                  {item.memberCount}
                </td>
                <td className="px-3.5 py-2.5">
                  {item.restrictedCount === 0 ? (
                    <span className="text-muted-foreground">—</span>
                  ) : (
                    item.restrictedCount
                  )}
                </td>
                <td className="px-3.5 py-2.5 text-right">
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => setRestrictTarget(item)}
                  >
                    Restrict access
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {query.hasNextPage ? (
        <Button
          type="button"
          variant="outline"
          disabled={query.isFetchingNextPage}
          onClick={() => void query.fetchNextPage()}
        >
          {query.isFetchingNextPage ? (
            <>
              <Spinner aria-hidden="true" />
              <span className="sr-only">Loading more</span>
            </>
          ) : (
            'Load more matters'
          )}
        </Button>
      ) : null}
      {restrictTarget ? (
        <RestrictAccessDialog
          client={client}
          scope={scope}
          project={restrictTarget}
          onClose={() => setRestrictTarget(null)}
        />
      ) : null}
    </div>
  );
}

function RestrictAccessDialog({
  client,
  scope,
  project,
  onClose,
}: {
  client: MattersApi;
  scope: ChatQueryScope;
  project: OrgProjectSummary;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const orgName =
    queryClient.getQueryData<{ readonly name?: string }>([
      'active-organization',
    ])?.name ?? 'your organization';
  const denies = useQuery({
    queryKey: ['org-matters', scope.orgId, project.id, 'denies'],
    queryFn: () => client.listDenies(project.id),
    retry: false,
  });
  const invalidate = async () => {
    if (!isTenantScopeCurrent(queryClient, scope)) return;
    await Promise.all([
      queryClient.invalidateQueries({
        queryKey: ['org-matters', scope.orgId],
      }),
      queryClient.invalidateQueries({
        queryKey: ['matters', scope.orgId, project.id],
      }),
    ]);
  };
  const remove = useMutation({
    mutationFn: (userId: string) => client.removeDeny(project.id, userId),
    onSettled: invalidate,
  });
  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="leading-[normal]">
            Restrict access to {project.name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-[13px] leading-[1.6]">
            Restricted members lose access at once and cannot be added back by
            the matter owner. Only owners and admins of {orgName} can lift a
            restriction.
          </p>
          <AddDenyRow
            client={client}
            project={project}
            taken={new Set((denies.data ?? []).map((d) => d.userId))}
            onAdded={invalidate}
          />
          <ul
            className="divide-border flex flex-col divide-y"
            aria-label="Restricted members"
          >
            {(denies.data ?? []).map((deny) => (
              <DenyRow
                key={deny.userId}
                deny={deny}
                disabled={remove.isPending}
                onLift={() => remove.mutate(deny.userId)}
              />
            ))}
          </ul>
          {denies.isPending ? (
            <div
              className="flex flex-col gap-2"
              role="status"
              aria-label="Loading restricted members"
            >
              {[0, 1].map((row) => (
                <Skeleton key={row} aria-hidden="true" className="h-8 w-full" />
              ))}
            </div>
          ) : null}
          {denies.isError ? (
            <p role="alert" className="text-destructive text-[13px]">
              We could not load the restricted members.
            </p>
          ) : null}
          {!denies.isPending && !denies.isError && !denies.data?.length ? (
            <p className="text-muted-foreground text-[13px]">
              No one is restricted from this matter.
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button type="button" variant="outline" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function DenyRow({
  deny,
  disabled,
  onLift,
}: {
  deny: DenySummary;
  disabled: boolean;
  onLift: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-1 py-2">
      <span
        aria-hidden="true"
        className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
      >
        {deny.name
          .split(/\s+/)
          .map((word) => word[0] ?? '')
          .slice(0, 2)
          .join('')
          .toUpperCase()}
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{deny.name}</p>
        <p className="text-muted-foreground truncate text-[13px]">
          {deny.setByName
            ? `Restricted by ${deny.setByName} · ${formatDayMonthYear(deny.createdAt)}`
            : 'Access restricted by your organization'}
        </p>
      </div>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={onLift}
      >
        Lift
      </Button>
    </li>
  );
}

function AddDenyRow({
  client,
  project,
  taken,
  onAdded,
}: {
  client: MattersApi;
  project: OrgProjectSummary;
  taken: Set<string>;
  onAdded: () => Promise<unknown>;
}) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [failed, setFailed] = useState(false);
  const results = useQuery({
    queryKey: ['matters', 'member-search', 'deny', project.id, query],
    queryFn: ({ signal }) => client.searchMembers({ q: query }, signal),
    enabled: query.trim().length > 0,
    retry: false,
  });
  const add = useMutation({
    mutationFn: (member: OrgMemberSummary) =>
      client.addDeny(project.id, { userId: member.userId }),
    onSuccess: async () => {
      setQuery('');
      setFailed(false);
      await onAdded();
    },
    onError: () => setFailed(true),
  });
  const candidates = (results.data ?? []).filter((m) => !taken.has(m.userId));
  return (
    <div className="flex flex-col gap-2">
      <Field>
        <FieldLabel htmlFor={inputId} className="sr-only">
          Add members by name or email
        </FieldLabel>
        <Input
          id={inputId}
          value={query}
          placeholder="Add members by name or email"
          onChange={(event) => setQuery(event.currentTarget.value)}
        />
      </Field>
      {candidates.length && query.trim() && !add.isPending ? (
        <ul
          className="divide-border border-border overflow-hidden rounded-lg border"
          aria-label="Matching members"
        >
          {candidates.slice(0, 5).map((m) => (
            <li key={m.userId}>
              <button
                type="button"
                className="hover:bg-muted flex w-full items-center gap-3 px-3 py-2 text-left"
                onClick={() => {
                  setQuery('');
                  setFailed(false);
                  add.mutate(m);
                }}
              >
                <span
                  aria-hidden="true"
                  className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                >
                  {m.name
                    .split(/\s+/)
                    .map((word) => word[0] ?? '')
                    .slice(0, 2)
                    .join('')
                    .toUpperCase()}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-medium">
                    {m.name}
                  </span>
                  <span className="text-muted-foreground block truncate text-[13px]">
                    {m.email}
                  </span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      {failed ? (
        <p role="alert" className="text-destructive text-[13px]">
          The member could not be restricted. Try again.
        </p>
      ) : null}
    </div>
  );
}

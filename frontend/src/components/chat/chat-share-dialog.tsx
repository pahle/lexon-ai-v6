'use client';

import { useId, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ChatApi,
  ChatShareSummary,
  OrgMemberSummary,
} from '@lexon/contracts';
import { createMattersClient } from '@/lib/matters-api';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import type { ChatQueryScope } from '@/lib/chat-queries';
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
import { UserPlusIcon, XIcon } from 'lucide-react';

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

function Avatar({ name }: { name: string }) {
  return (
    <span
      aria-hidden="true"
      className="bg-muted text-muted-foreground flex size-7 shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
    >
      {initials(name)}
    </span>
  );
}

/**
 * F6 §10 standalone-chat sharing: the owner grants read-only access to org
 * members — "can view" only; recipients cannot reply, edit, or delete.
 */
export function ChatShareDialog({
  chat,
  client,
  scope,
  open,
  onOpenChange,
}: {
  chat: { id: string; title: string };
  client: ChatApi;
  scope: ChatQueryScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const mattersClient = useMemo(
    () => createMattersClient({ baseUrl: '/api' }),
    [],
  );
  const shares = useQuery({
    queryKey: ['chat-shares', scope.orgId, chat.id],
    queryFn: () => client.listShares(chat.id),
    enabled: open,
    retry: false,
  });
  const invalidate = async () => {
    if (!isTenantScopeCurrent(queryClient, scope)) return;
    await queryClient.invalidateQueries({
      queryKey: ['chat-shares', scope.orgId, chat.id],
    });
  };
  const remove = useMutation({
    mutationFn: (userId: string) => client.removeShare(chat.id, userId),
    onSettled: invalidate,
  });
  const items = shares.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="leading-[normal]">Share chat</DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          <p className="text-muted-foreground text-[13px] leading-[1.6]">
            People you share with can read this chat. They can&rsquo;t reply,
            edit or delete it.
          </p>
          <AddShareRow
            client={client}
            mattersClient={mattersClient}
            chatId={chat.id}
            taken={new Set(items.map((s) => s.userId))}
            onAdded={invalidate}
          />
          <ul
            className="divide-border flex flex-col divide-y"
            aria-label="People with access"
          >
            {items.map((share) => (
              <ShareRow
                key={share.userId}
                share={share}
                disabled={remove.isPending}
                onRemove={() => remove.mutate(share.userId)}
              />
            ))}
          </ul>
          {shares.isPending ? (
            <div
              className="flex flex-col gap-2"
              role="status"
              aria-label="Loading shared access"
            >
              {[0, 1].map((row) => (
                <Skeleton key={row} aria-hidden="true" className="h-8 w-full" />
              ))}
            </div>
          ) : null}
          {shares.isError ? (
            <p role="alert" className="text-destructive text-[13px]">
              We could not load who can see this chat.
            </p>
          ) : null}
          <div className="flex justify-end">
            <Button
              type="button"
              variant="outline"
              onClick={() => onOpenChange(false)}
            >
              Done
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function ShareRow({
  share,
  disabled,
  onRemove,
}: {
  share: ChatShareSummary;
  disabled: boolean;
  onRemove: () => void;
}) {
  return (
    <li className="flex items-center gap-3 px-1 py-2">
      <Avatar name={share.name} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium">{share.name}</p>
        <p className="text-muted-foreground truncate text-[13px]">Can view</p>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="icon-sm"
        disabled={disabled}
        aria-label={`Remove ${share.name}`}
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </li>
  );
}

function AddShareRow({
  client,
  mattersClient,
  chatId,
  taken,
  onAdded,
}: {
  client: ChatApi;
  mattersClient: ReturnType<typeof createMattersClient>;
  chatId: string;
  taken: Set<string>;
  onAdded: () => Promise<unknown>;
}) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<OrgMemberSummary | null>(null);
  const [failed, setFailed] = useState(false);
  const results = useQuery({
    queryKey: ['matters', 'member-search', 'chat-share', chatId, query],
    queryFn: ({ signal }) => mattersClient.searchMembers({ q: query }, signal),
    enabled: query.trim().length > 0,
    retry: false,
  });
  const add = useMutation({
    mutationFn: () => client.addShares(chatId, { userIds: [picked!.userId] }),
    onSuccess: async () => {
      setPicked(null);
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
          Add people by name or email
        </FieldLabel>
        <div className="flex items-center gap-2">
          {picked ? (
            <span className="bg-muted flex h-9 items-center rounded-lg px-3 text-sm">
              {picked.name}
            </span>
          ) : (
            <Input
              id={inputId}
              value={query}
              placeholder="Add people by name or email"
              onChange={(event) => setQuery(event.currentTarget.value)}
            />
          )}
          <Button
            type="button"
            size="sm"
            disabled={!picked || add.isPending}
            onClick={() => {
              setFailed(false);
              add.mutate();
            }}
          >
            <UserPlusIcon aria-hidden="true" />
            Share
          </Button>
        </div>
      </Field>
      {picked ? null : candidates.length && query.trim() ? (
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
                  setPicked(m);
                  setQuery('');
                }}
              >
                <Avatar name={m.name} />
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
          The chat could not be shared. Try again.
        </p>
      ) : null}
    </div>
  );
}

'use client';

import { useEffect, useRef, useState } from 'react';
import type { ChatApi } from '@lexon/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog';
import {
  chatListQueryKey,
  chatSearchQueriesPrefix,
  chatThreadQueriesPrefix,
  removeChatSearchResults,
  type ChatQueryScope,
} from '@/lib/chat-queries';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';

export function ChatDeleteDialog({
  chatId,
  title,
  client,
  scope,
  onDeleted,
  open: controlledOpen,
  onOpenChange,
  showTrigger = true,
}: {
  chatId: string;
  title: string;
  client: ChatApi;
  scope: ChatQueryScope;
  onDeleted?: () => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
  showTrigger?: boolean;
}) {
  const queryClient = useQueryClient();
  const router = useRouter();
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const changeOpen = (next: boolean) => {
    if (controlledOpen === undefined) setLocalOpen(next);
    onOpenChange?.(next);
  };
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  async function remove() {
    if (busy) return;
    setBusy(true);
    setFailed(false);
    const prefix = chatThreadQueriesPrefix(scope);
    await queryClient.cancelQueries({ queryKey: prefix });
    const snapshots = queryClient.getQueriesData({ queryKey: prefix });
    const searchSnapshots = queryClient.getQueriesData({
      queryKey: chatSearchQueriesPrefix(scope),
    });
    queryClient.setQueriesData(
      { queryKey: chatListQueryKey(scope) },
      (data: unknown) => removeFromList(data, chatId),
    );
    removeChatSearchResults(queryClient, scope, chatId);
    try {
      await client.delete(chatId);
      if (!isTenantScopeCurrent(queryClient, scope)) return;
      await queryClient.invalidateQueries({ queryKey: prefix });
      queryClient.removeQueries({ queryKey: [...prefix, 'thread', chatId] });
      if (mounted.current) {
        changeOpen(false);
        onDeleted?.();
      }
      if (window.location.pathname === `/chats/${chatId}`)
        router.replace('/workspace');
    } catch {
      if (!isTenantScopeCurrent(queryClient, scope)) return;
      for (const [queryKey, data] of snapshots)
        queryClient.setQueryData(queryKey, data);
      for (const [queryKey, data] of searchSnapshots)
        queryClient.setQueryData(queryKey, data);
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current && isTenantScopeCurrent(queryClient, scope))
        setBusy(false);
    }
  }

  return (
    <>
      {showTrigger ? (
        <Button
          type="button"
          variant="ghost"
          className="w-full justify-start"
          onClick={() => changeOpen(true)}
        >
          Delete
        </Button>
      ) : null}
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) changeOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
            <AlertDialogDescription>
              “{title}” will be permanently deleted. This action cannot be
              undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failed ? (
            <p role="alert">
              The chat could not be deleted. You can try again.
            </p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={busy}
              onClick={(event) => {
                event.preventDefault();
                void remove();
              }}
            >
              {busy ? 'Deleting…' : 'Delete chat'}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function removeFromList(data: unknown, chatId: string): unknown {
  if (!data || typeof data !== 'object') return data;
  if ('pages' in data && Array.isArray(data.pages)) {
    const record = data as { pages: unknown[]; pageParams: unknown[] };
    return {
      ...record,
      pages: record.pages.map((page) => removeFromList(page, chatId)),
    };
  }
  if ('items' in data && Array.isArray(data.items)) {
    const record = data as { items: { id?: string }[]; [key: string]: unknown };
    return {
      ...record,
      items: record.items.filter((item) => item.id !== chatId),
    };
  }
  return data;
}

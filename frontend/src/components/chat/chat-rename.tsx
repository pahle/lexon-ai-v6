'use client';

import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ChatApi } from '@lexon/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Input } from '@/components/ui/input';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import type { ChatQueryScope } from '@/lib/chat-queries';

export function ChatRename({
  chatId,
  title,
  client,
  scope,
  onCancel,
  onSaved,
}: {
  chatId: string;
  title: string;
  client: ChatApi;
  scope: ChatQueryScope;
  onCancel: () => void;
  onSaved: (title: string) => void;
}) {
  const [value, setValue] = useState(title);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = value.trim();
    if (!normalized || Array.from(normalized).length > 120 || busy) return;
    setBusy(true);
    setFailed(false);
    try {
      await client.rename(chatId, { title: normalized });
      if (!mounted.current || !isTenantScopeCurrent(queryClient, scope)) return;
      onSaved(normalized);
    } catch {
      if (mounted.current && isTenantScopeCurrent(queryClient, scope))
        setFailed(true);
    } finally {
      if (mounted.current && isTenantScopeCurrent(queryClient, scope))
        setBusy(false);
    }
  }
  return (
    <form className="flex min-w-0 flex-1" onSubmit={save}>
      <Input
        aria-label="Chat title"
        value={value}
        maxLength={240}
        disabled={busy}
        onChange={(event) => setValue(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (event.key === 'Escape') {
            event.preventDefault();
            onCancel();
          }
        }}
        autoFocus
      />
      {failed ? (
        <p className="sr-only" role="alert">
          The title could not be saved. Try again.
        </p>
      ) : null}
      {Array.from(value.trim()).length > 120 ? (
        <p className="sr-only" role="alert">
          Titles must be 120 characters or fewer.
        </p>
      ) : null}
    </form>
  );
}

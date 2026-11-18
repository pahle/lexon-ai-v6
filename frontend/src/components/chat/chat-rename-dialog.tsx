'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import type { ChatApi } from '@lexon/contracts';
import { useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import type { ChatQueryScope } from '@/lib/chat-queries';

export type RenameTarget = { id: string; title: string };

export function ChatRenameDialog({
  chat,
  client,
  scope,
  open,
  onOpenChange,
  onSaved,
  returnFocusRef,
}: {
  chat: RenameTarget;
  client: ChatApi;
  scope: ChatQueryScope;
  open: boolean;
  returnFocusRef?: RefObject<HTMLElement | null>;
  onOpenChange: (open: boolean) => void;
  onSaved: (title: string) => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        initialFocus={inputRef}
        {...(returnFocusRef ? { finalFocus: returnFocusRef } : {})}
      >
        <DialogHeader>
          <DialogTitle>Rename chat</DialogTitle>
        </DialogHeader>
        <RenameForm
          chat={chat}
          client={client}
          scope={scope}
          inputRef={inputRef}
          onCancel={() => onOpenChange(false)}
          onSaved={(title) => {
            onSaved(title);
            onOpenChange(false);
          }}
        />
      </DialogContent>
    </Dialog>
  );
}

function RenameForm({
  chat,
  client,
  scope,
  inputRef,
  onCancel,
  onSaved,
}: {
  chat: RenameTarget;
  client: ChatApi;
  scope: ChatQueryScope;
  inputRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onSaved: (title: string) => void;
}) {
  const inputId = useId();
  const [value, setValue] = useState(chat.title);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    inputRef.current?.focus();
    inputRef.current?.select();
    return () => {
      mounted.current = false;
    };
  }, [inputRef]);
  const tooLong = Array.from(value.trim()).length > 120;
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const normalized = value.trim();
    if (busy) return;
    if (!normalized) {
      setEmpty(true);
      return;
    }
    if (tooLong) return;
    setBusy(true);
    setFailed(false);
    try {
      await client.rename(chat.id, { title: normalized });
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
    <form className="grid gap-4" onSubmit={save}>
      <Field>
        <FieldLabel htmlFor={inputId}>Chat title</FieldLabel>
        <Input
          id={inputId}
          ref={inputRef}
          value={value}
          maxLength={240}
          disabled={busy}
          aria-invalid={tooLong || empty || failed || undefined}
          onChange={(event) => {
            setValue(event.currentTarget.value);
            setEmpty(false);
          }}
        />
        {failed ? (
          <FieldError>The title could not be saved. Try again.</FieldError>
        ) : null}
        {tooLong ? (
          <FieldError>Titles must be 120 characters or fewer.</FieldError>
        ) : null}
        {empty ? <FieldError>Enter a chat title.</FieldError> : null}
      </Field>
      <DialogFooter className="flex-row justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Save
        </Button>
      </DialogFooter>
    </form>
  );
}

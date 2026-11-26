'use client';

import {
  useEffect,
  useId,
  useRef,
  useState,
  type FormEvent,
  type RefObject,
} from 'react';
import type { MattersApi } from '@/lib/matters-api';
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

export function NewMatterDialog({
  client,
  scope,
  open,
  onOpenChange,
  onSaved,
}: {
  client: MattersApi;
  scope: ChatQueryScope;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSaved: () => void;
}) {
  const nameRef = useRef<HTMLInputElement>(null);
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent showCloseButton={false} initialFocus={nameRef}>
        <DialogHeader>
          <DialogTitle className="leading-[normal]">New matter</DialogTitle>
        </DialogHeader>
        {open ? (
          <NewMatterForm
            client={client}
            scope={scope}
            nameRef={nameRef}
            onCancel={() => onOpenChange(false)}
            onSaved={() => {
              onSaved();
              onOpenChange(false);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}

function NewMatterForm({
  client,
  scope,
  nameRef,
  onCancel,
  onSaved,
}: {
  client: MattersApi;
  scope: ChatQueryScope;
  nameRef: RefObject<HTMLInputElement | null>;
  onCancel: () => void;
  onSaved: () => void;
}) {
  const nameId = useId();
  const numberId = useId();
  const areaId = useId();
  const [name, setName] = useState('');
  const [matterNumber, setMatterNumber] = useState('');
  const [practiceArea, setPracticeArea] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const [empty, setEmpty] = useState(false);
  const queryClient = useQueryClient();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const tooLong = (value: string, max: number) =>
    Array.from(value.trim()).length > max;

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    if (!trimmed) {
      setEmpty(true);
      return;
    }
    if (
      tooLong(trimmed, 120) ||
      tooLong(matterNumber, 64) ||
      tooLong(practiceArea, 120)
    )
      return;
    setBusy(true);
    setFailed(false);
    try {
      await client.create({
        name: trimmed,
        ...(matterNumber.trim() ? { matterNumber: matterNumber.trim() } : {}),
        ...(practiceArea.trim() ? { practiceArea: practiceArea.trim() } : {}),
      });
      if (!mounted.current || !isTenantScopeCurrent(queryClient, scope)) return;
      onSaved();
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
        <FieldLabel htmlFor={nameId}>Matter name</FieldLabel>
        <Input
          id={nameId}
          ref={nameRef}
          value={name}
          maxLength={240}
          disabled={busy}
          aria-invalid={empty || failed || tooLong(name, 120) || undefined}
          onChange={(event) => {
            setName(event.currentTarget.value);
            setEmpty(false);
          }}
        />
        {empty ? <FieldError>Enter a matter name.</FieldError> : null}
        {tooLong(name, 120) ? (
          <FieldError>Names must be 120 characters or fewer.</FieldError>
        ) : null}
      </Field>
      <Field>
        <FieldLabel htmlFor={numberId}>Matter number</FieldLabel>
        <Input
          id={numberId}
          value={matterNumber}
          maxLength={80}
          disabled={busy}
          aria-invalid={tooLong(matterNumber, 64) || undefined}
          onChange={(event) => setMatterNumber(event.currentTarget.value)}
        />
        {tooLong(matterNumber, 64) ? (
          <FieldError>
            Matter numbers must be 64 characters or fewer.
          </FieldError>
        ) : null}
      </Field>
      <Field>
        <FieldLabel htmlFor={areaId}>Practice area</FieldLabel>
        <Input
          id={areaId}
          value={practiceArea}
          maxLength={120}
          disabled={busy}
          aria-invalid={tooLong(practiceArea, 120) || undefined}
          onChange={(event) => setPracticeArea(event.currentTarget.value)}
        />
        {tooLong(practiceArea, 120) ? (
          <FieldError>
            Practice areas must be 120 characters or fewer.
          </FieldError>
        ) : null}
      </Field>
      {failed ? (
        <FieldError>The matter could not be created. Try again.</FieldError>
      ) : null}
      <DialogFooter className="mt-2 flex-row justify-end">
        <Button type="button" variant="outline" onClick={onCancel}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy}>
          Create matter
        </Button>
      </DialogFooter>
    </form>
  );
}

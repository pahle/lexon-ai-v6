'use client';

import { useId, useState } from 'react';
import { UserPlusIcon, XIcon } from 'lucide-react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  DenySummary,
  OrgMemberSummary,
  ProjectMemberSummary,
} from '@lexon/contracts';
import type { MattersApi, ProjectDetail } from '@/lib/matters-api';
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
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import type { ChatQueryScope } from '@/lib/chat-queries';
import type { OrgRole } from '@lexon/contracts';
import { cn } from '@/lib/utils';

const ROLES = [
  { value: 'viewer', label: 'Viewer' },
  { value: 'editor', label: 'Editor' },
] as const;

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

function MemberRow({
  name,
  email,
  roleControl,
  restricted,
}: {
  name: string;
  email?: string | undefined;
  roleControl?: React.ReactNode;
  restricted?: string;
}) {
  return (
    <li className="flex items-center gap-3 px-1 py-2">
      <Avatar name={name} />
      <div className="min-w-0 flex-1">
        <p
          className={cn(
            'truncate text-sm font-medium',
            restricted && 'text-muted-foreground',
          )}
        >
          {name}
        </p>
        <p className="text-muted-foreground truncate text-[13px]">
          {restricted ?? email}
        </p>
      </div>
      {roleControl}
    </li>
  );
}

export function MembersDialog({
  client,
  scope,
  project,
  orgRole,
  open,
  onOpenChange,
}: {
  client: MattersApi;
  scope: ChatQueryScope;
  project: ProjectDetail;
  orgRole?: OrgRole;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const canManage = project.myRole === 'owner';
  const canSeeRestricted =
    canManage || orgRole === 'owner' || orgRole === 'admin';
  const members = useQuery({
    queryKey: ['matters', scope.orgId, project.id, 'members'],
    queryFn: () => client.listMembers(project.id),
    enabled: open,
    retry: false,
  });
  // Restricted members surface only where the denies route answers — org
  // owner/admin or a project owner who is also one; a refusal renders none.
  const denies = useQuery({
    queryKey: ['matters', scope.orgId, project.id, 'denies'],
    queryFn: () => client.listDenies(project.id),
    enabled: open && canSeeRestricted,
    retry: false,
  });
  const invalidate = async () => {
    if (!isTenantScopeCurrent(queryClient, scope)) return;
    await queryClient.invalidateQueries({
      queryKey: ['matters', scope.orgId, project.id],
    });
  };
  const changeRole = useMutation({
    mutationFn: (input: { userId: string; role: 'viewer' | 'editor' }) =>
      client.updateMemberRole(project.id, input.userId, { role: input.role }),
    onSettled: invalidate,
  });
  const removeMember = useMutation({
    mutationFn: (userId: string) => client.removeMember(project.id, userId),
    onSettled: invalidate,
  });
  const items = members.data ?? [];
  const deniedRows = denies.data ?? [];
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle className="leading-[normal]">
            Members of {project.name}
          </DialogTitle>
        </DialogHeader>
        <div className="flex flex-col gap-4">
          {canManage ? (
            <AddMemberRow
              client={client}
              project={project}
              taken={
                new Set([
                  project.owner.userId,
                  ...items.map((m) => m.userId),
                  ...deniedRows.map((d) => d.userId),
                ])
              }
              onAdded={invalidate}
            />
          ) : null}
          <ul
            className="divide-border flex flex-col divide-y"
            aria-label="Matter members"
          >
            <MemberRow
              name={
                project.owner.userId === scope.userId
                  ? `${project.owner.name} (you)`
                  : project.owner.name
              }
              email={project.owner.email}
              roleControl={
                <span className="text-muted-foreground text-[13px]">Owner</span>
              }
            />
            {items.map((m) => (
              <MemberRow
                key={m.userId}
                name={m.name}
                email={m.email}
                roleControl={
                  canManage ? (
                    <MemberRoleControl
                      member={m}
                      disabled={changeRole.isPending || removeMember.isPending}
                      onRole={(role) =>
                        changeRole.mutate({ userId: m.userId, role })
                      }
                      onRemove={() => removeMember.mutate(m.userId)}
                    />
                  ) : (
                    <Badge variant="outline" className="border-input">
                      {m.role === 'editor' ? 'Editor' : 'Viewer'}
                    </Badge>
                  )
                }
              />
            ))}
            {deniedRows.map((d: DenySummary) => (
              <MemberRow
                key={d.userId}
                name={d.name}
                restricted="Access restricted by your organization"
              />
            ))}
          </ul>
          {members.isPending ? (
            <div
              className="flex flex-col gap-2"
              role="status"
              aria-label="Loading members"
            >
              {[0, 1].map((row) => (
                <Skeleton key={row} aria-hidden="true" className="h-8 w-full" />
              ))}
            </div>
          ) : null}
          {members.isError ? (
            <p role="alert" className="text-destructive text-[13px]">
              We could not load the members of this matter.
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

function MemberRoleControl({
  member,
  disabled,
  onRole,
  onRemove,
}: {
  member: ProjectMemberSummary;
  disabled: boolean;
  onRole: (role: 'viewer' | 'editor') => void;
  onRemove: () => void;
}) {
  return (
    <div className="flex items-center gap-1">
      <Select
        value={member.role}
        onValueChange={(value) => onRole(value as 'viewer' | 'editor')}
      >
        <SelectTrigger
          aria-label={`Role for ${member.name}`}
          disabled={disabled}
          className="data-[size=default]:h-[30px] gap-1 rounded-lg px-2.5 text-[13px] font-medium [&>svg]:size-3.5!"
        >
          <SelectValue>
            {member.role === 'editor' ? 'Editor' : 'Viewer'}
          </SelectValue>
        </SelectTrigger>
        <SelectContent>
          <SelectGroup>
            {ROLES.map((role) => (
              <SelectItem key={role.value} value={role.value}>
                {role.label}
              </SelectItem>
            ))}
          </SelectGroup>
        </SelectContent>
      </Select>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        disabled={disabled}
        aria-label={`Remove ${member.name}`}
        className="text-muted-foreground size-8"
        onClick={onRemove}
      >
        <XIcon aria-hidden="true" />
      </Button>
    </div>
  );
}

function AddMemberRow({
  client,
  project,
  taken,
  onAdded,
}: {
  client: MattersApi;
  project: ProjectDetail;
  taken: Set<string>;
  onAdded: () => Promise<unknown>;
}) {
  const inputId = useId();
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<OrgMemberSummary | null>(null);
  const [role, setRole] = useState<'viewer' | 'editor'>('editor');
  const [failed, setFailed] = useState(false);
  const results = useQuery({
    queryKey: ['matters', 'member-search', project.id, query],
    queryFn: ({ signal }) => client.searchMembers({ q: query }, signal),
    enabled: query.trim().length > 0,
    retry: false,
  });
  const add = useMutation({
    mutationFn: () =>
      client.addMember(project.id, { userId: picked!.userId, role }),
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
          <Select
            value={role}
            onValueChange={(value) => setRole(value as 'viewer' | 'editor')}
          >
            <SelectTrigger
              aria-label="Role for the new member"
              className="data-[size=default]:h-9 w-[110px] gap-1 px-2.5 text-[13px] [&>svg]:size-3.5!"
            >
              <SelectValue>
                {role === 'editor' ? 'Editor' : 'Viewer'}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectGroup>
                {ROLES.map((option) => (
                  <SelectItem key={option.value} value={option.value}>
                    {option.label}
                  </SelectItem>
                ))}
              </SelectGroup>
            </SelectContent>
          </Select>
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
            Add
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
          The member could not be added. Try again.
        </p>
      ) : null}
    </div>
  );
}

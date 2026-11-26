'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  MoreHorizontalIcon,
  PencilLineIcon,
  SettingsIcon,
  TrashIcon,
  UsersIcon,
} from 'lucide-react';
import type { ChatApi, OrgRole } from '@lexon/contracts';
import type { MattersApi, ProjectDetail } from '@/lib/matters-api';
import {
  ConfirmDialog,
  DataStates,
  DataTableCard,
  MutedCell,
  StatusBadge,
} from '../data-views';
import { ListFailure } from '../states/list-failure';
import { LoadingState } from '../states/page-states';
import { WorkspaceNotFound } from '../states/workspace-not-found';
import { ChatClientError } from '@/lib/chat-errors';
import { Button } from '../ui/button';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../ui/dropdown-menu';
import { Textarea } from '../ui/textarea';
import { Spinner } from '../ui/spinner';
import { formatActivityDate } from '@/lib/date-time';
import type { ChatQueryScope } from '@/lib/chat-queries';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import { MembersDialog } from './members-dialog';
import { MatterSettingsDialog } from './matter-settings-dialog';

const MAX_INSTRUCTIONS = 8_000;

/** One matter: chats, instructions and members, gated by the caller's role. */
export function MatterPage({
  client,
  scope,
  projectId,
  chatClient,
  orgRole,
  teamWorkspace = true,
}: {
  client: MattersApi;
  scope: ChatQueryScope;
  projectId: string;
  chatClient?: ChatApi;
  orgRole?: OrgRole;
  teamWorkspace?: boolean;
}) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [membersOpen, setMembersOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const project = useQuery({
    queryKey: ['matters', scope.orgId, projectId, 'detail'],
    queryFn: () => client.detail(projectId),
    retry: false,
  });
  const chats = useQuery({
    queryKey: ['matters', scope.orgId, projectId, 'chats'],
    queryFn: () => client.listChats(projectId),
    enabled: project.isSuccess,
    retry: false,
  });
  const invalidateProject = async () => {
    if (!isTenantScopeCurrent(queryClient, scope)) return;
    await queryClient.invalidateQueries({
      queryKey: ['matters', scope.orgId, projectId],
    });
    await queryClient.invalidateQueries({ queryKey: ['matters', scope.orgId] });
  };
  const remove = useMutation({
    mutationFn: () => client.remove(projectId),
    onSuccess: async () => {
      if (!isTenantScopeCurrent(queryClient, scope)) return;
      await queryClient.invalidateQueries({ queryKey: ['matters'] });
      router.push('/matters');
    },
  });

  if (project.isPending) return <LoadingState message="Loading this matter" />;
  // A 404 (denied, removed, or absent matter) is the same not-found state as a
  // missing route — a retry can never succeed. Other failures can.
  if (project.isError)
    return project.error instanceof ChatClientError &&
      project.error.status === 404 ? (
      <WorkspaceNotFound />
    ) : (
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-6 py-7">
        <ListFailure
          thing="this matter"
          onRetry={() => void project.refetch()}
        />
      </div>
    );

  const detail = project.data;
  const canWrite = detail.myRole === 'owner' || detail.myRole === 'editor';
  const isOwner = detail.myRole === 'owner';
  const meta = [detail.matterNumber, detail.practiceArea]
    .filter((part) => part !== null)
    .join(' · ');
  const chatItems = chats.data ?? [];

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-1 flex-col gap-5 px-6 py-7 max-md:px-4 max-md:py-5">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="min-w-0 font-serif text-[32px] leading-[normal] font-normal tracking-[-0.005em]">
            {detail.name}
          </h1>
          {meta ? <MutedCell>{meta}</MutedCell> : null}
        </div>
        <div className="flex items-center gap-2">
          {canWrite && teamWorkspace ? (
            <Button
              type="button"
              variant="outline"
              onClick={() => setMembersOpen(true)}
            >
              <UsersIcon aria-hidden="true" />
              Members
            </Button>
          ) : null}
          {canWrite ? (
            <DropdownMenu>
              <DropdownMenuTrigger
                render={
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label="Matter actions"
                  />
                }
              >
                <MoreHorizontalIcon aria-hidden="true" />
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-44">
                <DropdownMenuItem onClick={() => setSettingsOpen(true)}>
                  <SettingsIcon aria-hidden="true" data-icon="inline-start" />
                  Matter settings
                </DropdownMenuItem>
                {isOwner ? (
                  <DropdownMenuItem
                    variant="destructive"
                    onClick={() => setDeleting(true)}
                  >
                    <TrashIcon aria-hidden="true" data-icon="inline-start" />
                    Delete matter
                  </DropdownMenuItem>
                ) : null}
              </DropdownMenuContent>
            </DropdownMenu>
          ) : (
            <StatusBadge tone="inactive">Viewer</StatusBadge>
          )}
        </div>
      </header>
      {canWrite ? (
        <MatterComposer
          matterName={detail.name}
          projectId={projectId}
          {...(chatClient ? { chatClient } : {})}
          onCreated={(chatId) => router.push(`/chats/${chatId}`)}
        />
      ) : null}
      <DataTableCard
        title="Chats"
        {...(chats.data ? { count: chats.data.length } : {})}
        description="Every chat in this matter."
      >
        {chats.isPending ? (
          <DataStates
            status="loading"
            pageSize={3}
            onRetry={() => void chats.refetch()}
            onReset={() => undefined}
            emptyText=""
            thing="chats"
          />
        ) : chats.isError ? (
          <div className="px-4 pt-4 pb-5 md:px-5">
            <ListFailure
              thing="the chats in this matter"
              onRetry={() => void chats.refetch()}
            />
          </div>
        ) : chatItems.length ? (
          <ul className="divide-border flex flex-col divide-y">
            {chatItems.map((chat) => (
              <li key={chat.id}>
                <Link
                  href={`/chats/${chat.id}`}
                  className="hover:bg-muted flex items-center justify-between gap-4 px-4 py-3 md:px-5"
                >
                  <span className="min-w-0 flex-1 truncate text-sm font-medium">
                    {chat.title}
                  </span>
                  <MutedCell>
                    {formatActivityDate(chat.updatedAt, { yesterday: true })}
                  </MutedCell>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-muted-foreground px-4 pt-4 pb-6 text-[13px] md:px-5">
            No chats in this matter yet.
          </p>
        )}
      </DataTableCard>
      <InstructionsCard
        client={client}
        detail={detail}
        onSaved={invalidateProject}
      />
      <MembersDialog
        client={client}
        scope={scope}
        project={detail}
        {...(orgRole ? { orgRole } : {})}
        open={membersOpen}
        onOpenChange={setMembersOpen}
      />
      <MatterSettingsDialog
        client={client}
        scope={scope}
        project={detail}
        open={settingsOpen}
        onOpenChange={setSettingsOpen}
        onSaved={invalidateProject}
      />
      <ConfirmDialog
        open={deleting}
        onOpenChange={setDeleting}
        title={`Delete ${detail.name}?`}
        description={`This deletes the matter and its ${detail.chatCount} ${detail.chatCount === 1 ? 'chat' : 'chats'}. This cannot be undone.`}
        confirmLabel="Delete matter"
        icon={TrashIcon}
        destructive
        pending={remove.isPending}
        onConfirm={() => remove.mutate()}
      />
    </div>
  );
}

/** First-message composer for a new chat inside the matter. */
function MatterComposer({
  matterName,
  projectId,
  chatClient,
  onCreated,
}: {
  matterName: string;
  projectId: string;
  chatClient?: ChatApi;
  onCreated: (chatId: string) => void;
}) {
  const [text, setText] = useState('');
  const [sending, setSending] = useState(false);
  const [failed, setFailed] = useState(false);
  const pendingIdentity = useRef<{
    text: string;
    chatId: string;
    userMessageId: string;
    requestId: string;
  } | null>(null);

  async function send(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const value = text.trim();
    if (!value || sending || !chatClient) return;
    setSending(true);
    setFailed(false);
    try {
      const pending = pendingIdentity.current;
      const identity =
        pending?.text === value
          ? pending
          : {
              text: value,
              chatId: crypto.randomUUID(),
              userMessageId: crypto.randomUUID(),
              requestId: crypto.randomUUID(),
            };
      pendingIdentity.current = identity;
      const result = await chatClient.create({
        chatId: identity.chatId,
        userMessageId: identity.userMessageId,
        requestId: identity.requestId,
        text: value,
        effort: 'high',
        projectId,
      });
      if (pendingIdentity.current === identity) pendingIdentity.current = null;
      setText('');
      onCreated(result.chatId);
    } catch {
      setFailed(true);
    } finally {
      setSending(false);
    }
  }

  return (
    <form
      aria-label={`Start a chat in ${matterName}`}
      className="border-border bg-background flex flex-col gap-2 rounded-[12px] border p-3"
      onSubmit={send}
    >
      <Textarea
        value={text}
        placeholder="Ask Lexon about this matter..."
        rows={3}
        disabled={sending}
        onChange={(event) => setText(event.currentTarget.value)}
      />
      <div className="flex items-center justify-between gap-3">
        {failed ? (
          <p role="alert" className="text-destructive text-[13px]">
            The chat could not be started. Try again.
          </p>
        ) : (
          <span />
        )}
        <Button type="submit" disabled={!text.trim() || sending || !chatClient}>
          {sending ? <Spinner aria-hidden="true" /> : null}
          Send
        </Button>
      </div>
    </form>
  );
}

function InstructionsCard({
  client,
  detail,
  onSaved,
}: {
  client: MattersApi;
  detail: ProjectDetail;
  onSaved: () => Promise<unknown>;
}) {
  const canWrite = detail.myRole === 'owner' || detail.myRole === 'editor';
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [expanded, setExpanded] = useState(false);
  const [failed, setFailed] = useState(false);
  const save = useMutation({
    mutationFn: () =>
      client.updateInstructions(detail.id, {
        instructions: value.trim() ? value : null,
      }),
    onSuccess: async () => {
      setFailed(false);
      setEditing(false);
      await onSaved();
    },
    onError: () => setFailed(true),
  });
  const instructions = detail.instructions ?? '';
  const length = Array.from(value).length;
  const clamped =
    !expanded && Array.from(instructions).length > 320
      ? `${Array.from(instructions).slice(0, 320).join('')}…`
      : instructions;

  return (
    <DataTableCard
      title="Matter instructions"
      description="Instructions Lexon applies to every chat in this matter."
    >
      <div className="px-4 pt-3 pb-4 md:px-5">
        {editing ? (
          <div className="flex flex-col gap-2">
            <Textarea
              value={value}
              rows={8}
              aria-label="Matter instructions"
              onChange={(event) => setValue(event.currentTarget.value)}
            />
            <div className="flex items-center justify-between gap-3">
              <MutedCell>{`${length.toLocaleString('en-US')} / 8,000`}</MutedCell>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditing(false)}
                >
                  Cancel
                </Button>
                <Button
                  type="button"
                  disabled={length > MAX_INSTRUCTIONS || save.isPending}
                  onClick={() => {
                    setFailed(false);
                    save.mutate();
                  }}
                >
                  {save.isPending ? <Spinner aria-hidden="true" /> : null}
                  Save
                </Button>
              </div>
            </div>
            {failed ? (
              <p role="alert" className="text-destructive text-[13px]">
                The instructions could not be saved. Try again.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            {instructions ? (
              <p className="text-sm whitespace-pre-wrap">{clamped}</p>
            ) : (
              <p className="text-muted-foreground text-[13px]">
                No instructions yet.
              </p>
            )}
            <div className="flex items-center gap-2">
              {Array.from(instructions).length > 320 ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setExpanded((on) => !on)}
                >
                  {expanded ? 'Show less' : 'Show more'}
                </Button>
              ) : null}
              {canWrite ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setValue(instructions);
                    setEditing(true);
                  }}
                >
                  <PencilLineIcon aria-hidden="true" />
                  Edit
                </Button>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </DataTableCard>
  );
}

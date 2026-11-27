'use client';

import { useRef, useState, type FormEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import {
  ArrowUpIcon,
  BrainIcon,
  EyeIcon,
  LockIcon,
  PencilLineIcon,
  SettingsIcon,
  TrashIcon,
  UsersIcon,
} from 'lucide-react';
import type { ChatApi, OrgRole } from '@lexon/contracts';
import type {
  MattersApi,
  ProjectChatItem,
  ProjectDetail,
} from '@/lib/matters-api';
import {
  ConfirmDialog,
  DataStates,
  DataTable,
  DataTableCard,
  MutedCell,
  PagedFooter,
  RowMenu,
  type DataColumn,
  type RowMenuItem,
} from '../data-views';
import { ListFailure } from '../states/list-failure';
import { LoadingState } from '../states/page-states';
import { WorkspaceNotFound } from '../states/workspace-not-found';
import { ChatClientError } from '@/lib/chat-errors';
import { Button } from '../ui/button';
import { Textarea } from '../ui/textarea';
import { Spinner } from '../ui/spinner';
import { composerClasses } from '@/components/chat/composer-styles';
import { formatActivityDate } from '@/lib/date-time';
import type { ChatQueryScope } from '@/lib/chat-queries';
import { isTenantScopeCurrent } from '@/lib/tenant-queries';
import { cn } from '@/lib/utils';
import { MembersDialog } from './members-dialog';
import { MatterSettingsDialog } from './matter-settings-dialog';

const MAX_INSTRUCTIONS = 8_000;

const initials = (name: string) =>
  name
    .split(/\s+/)
    .map((word) => word[0] ?? '')
    .slice(0, 2)
    .join('')
    .toUpperCase();

/** The stacked member avatars in the header row (r18): owner first, then members. */
function AvatarStack({ names }: { names: string[] }) {
  return (
    <span className="inline-flex items-center" aria-hidden="true">
      {names.slice(0, 3).map((name, index) => (
        <span
          key={name}
          className={cn(
            'bg-muted text-muted-foreground border-background flex size-6 items-center justify-center rounded-full border-2 text-[10px] font-semibold',
            index > 0 && '-ml-1.5',
          )}
        >
          {initials(name)}
        </span>
      ))}
    </span>
  );
}

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
  const members = useQuery({
    queryKey: ['matters', scope.orgId, projectId, 'members'],
    queryFn: () => client.listMembers(projectId),
    enabled: project.isSuccess && teamWorkspace,
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
  const isViewer = detail.myRole === 'viewer';
  const meta = [detail.matterNumber, detail.practiceArea]
    .filter((part) => part !== null)
    .join(' · ');
  const chatItems = chats.data ?? [];
  const headerNames = [
    detail.owner.name,
    ...(members.data ?? []).map((member) => member.name),
  ];
  const actionsMenu = (
    <RowMenu
      label="Matter actions"
      items={
        [
          {
            label: 'Matter settings',
            icon: EyeIcon,
            onSelect: () => setSettingsOpen(true),
          },
          ...(detail.myRole === 'owner'
            ? [
                {
                  label: 'Delete matter',
                  icon: TrashIcon,
                  destructive: true,
                  separatorBefore: true,
                  onSelect: () => setDeleting(true),
                } satisfies RowMenuItem,
              ]
            : []),
        ] as RowMenuItem[]
      }
    />
  );

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-1 flex-col gap-4 px-4 pt-5 pb-5 md:gap-5 md:px-6 md:pt-7 md:pb-10">
      <header className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 flex-col gap-1">
          <h1 className="min-w-0 font-serif text-[26px] leading-[1.15] font-normal tracking-[-0.005em] md:text-[30px]">
            {detail.name}
          </h1>
          {meta ? <MutedCell>{meta}</MutedCell> : null}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isViewer ? (
            <span className="text-muted-foreground px-1 text-sm">Viewer</span>
          ) : (
            <>
              {teamWorkspace ? (
                <>
                  <AvatarStack names={headerNames} />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setMembersOpen(true)}
                  >
                    <UsersIcon aria-hidden="true" />
                    Members
                  </Button>
                </>
              ) : null}
              <Button
                type="button"
                variant="ghost"
                size="icon"
                aria-label="Matter settings"
                className="text-muted-foreground"
                onClick={() => setSettingsOpen(true)}
              >
                <SettingsIcon aria-hidden="true" />
              </Button>
              {actionsMenu}
            </>
          )}
        </div>
      </header>
      {canWrite || !teamWorkspace ? (
        <MatterComposer
          matterName={detail.name}
          projectId={projectId}
          {...(chatClient ? { chatClient } : {})}
          onCreated={(chatId) => router.push(`/chats/${chatId}`)}
        />
      ) : (
        <p className="border-border bg-muted/40 text-muted-foreground flex items-center gap-2 rounded-[12px] border px-4 py-3 text-sm">
          <LockIcon className="size-3.5 shrink-0" aria-hidden="true" />
          You can view this matter. Ask the owner for edit access to start
          chats.
        </p>
      )}
      <div className="grid items-start gap-4 md:grid-cols-[minmax(0,1fr)_minmax(280px,340px)] md:gap-5">
        <DataTableCard
          title="Chats"
          {...(chats.data ? { count: chats.data.length } : {})}
          className="order-2 md:order-1"
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
            <ChatsTable
              chats={chatItems}
              userId={scope.userId}
              onOpen={(chat) => router.push(`/chats/${chat.id}`)}
            />
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
          className="order-1 md:order-2"
        />
      </div>
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

const chatColumns = (
  userId: string,
  onOpen: (chat: ProjectChatItem) => void,
): DataColumn<ProjectChatItem>[] => [
  {
    key: 'chat',
    header: 'Chat',
    cell: (chat) => <span className="font-medium">{chat.title}</span>,
  },
  {
    key: 'owner',
    header: 'Owner',
    width: '140px',
    muted: true,
    cell: (chat) => chat.ownerName ?? '—',
  },
  {
    key: 'activity',
    header: 'Last activity',
    width: '130px',
    muted: true,
    cell: (chat) => formatActivityDate(chat.updatedAt, { yesterday: true }),
  },
  {
    key: 'menu',
    header: 'Actions',
    hideHeader: true,
    width: '56px',
    cell: (chat) =>
      chat.ownerUserId === userId ? (
        <RowMenu
          label={`Actions for ${chat.title}`}
          items={[
            {
              label: 'Open chat',
              icon: EyeIcon,
              onSelect: () => onOpen(chat),
            },
          ]}
        />
      ) : null,
  },
];

function ChatsTable({
  chats,
  userId,
  onOpen,
}: {
  chats: ProjectChatItem[];
  userId: string;
  onOpen: (chat: ProjectChatItem) => void;
}) {
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const pageRows = chats.slice((page - 1) * pageSize, page * pageSize);
  return (
    <>
      <DataTable
        columns={chatColumns(userId, onOpen)}
        rows={pageRows}
        getRowId={(chat) => chat.id}
        onOpen={onOpen}
        openLabel={(chat) => `Open ${chat.title}`}
        sort={{ key: 'activity', direction: 'descending' }}
        mobileRow={(chat) => ({
          title: chat.title,
          meta: `${chat.ownerName ?? '—'} · ${formatActivityDate(chat.updatedAt, { yesterday: true })}`,
          trailing:
            chat.ownerUserId === userId ? (
              <RowMenu
                label={`Actions for ${chat.title}`}
                items={[
                  {
                    label: 'Open chat',
                    icon: EyeIcon,
                    onSelect: () => onOpen(chat),
                  },
                ]}
              />
            ) : undefined,
        })}
      />
      <PagedFooter
        page={page}
        pageSize={pageSize}
        total={chats.length}
        onPage={setPage}
        onPageSize={(size) => {
          setPageSize(size);
          setPage(1);
        }}
        noun="chat"
      />
    </>
  );
}

/** First-message composer for a new chat inside the matter — the standard
 * workspace composer surface (r18 `.comp`), same shell, Deep thinking and
 * round send control as the thread composer. */
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
  const [deepThinking, setDeepThinking] = useState(false);
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
        effort: deepThinking ? 'max' : 'high',
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
      onSubmit={send}
      className={composerClasses.shell}
    >
      <Textarea
        value={text}
        placeholder="Start a chat in this matter…"
        aria-label="Start a chat in this matter"
        rows={2}
        disabled={sending}
        onChange={(event) => setText(event.currentTarget.value)}
        onKeyDown={(event) => {
          if (
            event.key === 'Enter' &&
            !event.shiftKey &&
            !event.nativeEvent.isComposing
          ) {
            event.preventDefault();
            event.currentTarget.form?.requestSubmit();
          }
        }}
        className={cn(
          composerClasses.input,
          'border-0 shadow-none focus-visible:ring-0',
        )}
      />
      <div className={composerClasses.toolbar}>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          aria-label="Deep thinking"
          aria-pressed={deepThinking}
          className={cn(
            composerClasses.deepThinking,
            deepThinking && composerClasses.deepThinkingPressed,
          )}
          onClick={() => setDeepThinking((on) => !on)}
        >
          <BrainIcon aria-hidden="true" /> Deep thinking
        </Button>
        <Button
          type="submit"
          size="icon"
          disabled={!text.trim() || sending || !chatClient}
          className={composerClasses.send}
          aria-label="Send message"
        >
          {sending ? <Spinner aria-hidden="true" /> : <ArrowUpIcon />}
        </Button>
      </div>
      {failed ? (
        <p role="alert" className="text-destructive text-[13px]">
          The chat could not be started. Try again.
        </p>
      ) : null}
    </form>
  );
}

function InstructionsCard({
  client,
  detail,
  onSaved,
  className,
}: {
  client: MattersApi;
  detail: ProjectDetail;
  onSaved: () => Promise<unknown>;
  className?: string;
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
      title="Instructions"
      {...(className ? { className } : {})}
      actions={
        canWrite && !editing ? (
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
        ) : undefined
      }
    >
      <div className="px-4 pt-3 pb-4 md:px-5">
        {editing ? (
          <div className="flex flex-col gap-2.5">
            <Textarea
              value={value}
              rows={6}
              aria-label="Matter instructions"
              onChange={(event) => setValue(event.currentTarget.value)}
              className="min-h-28 leading-[1.55]"
            />
            <div className="flex items-center justify-between gap-3">
              <MutedCell>
                Lexon follows these in every chat in this matter.
              </MutedCell>
              <MutedCell>{`${length.toLocaleString('en-US')} / 8,000`}</MutedCell>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setEditing(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                size="sm"
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
            {failed ? (
              <p role="alert" className="text-destructive text-[13px]">
                The instructions could not be saved. Try again.
              </p>
            ) : null}
          </div>
        ) : (
          <div className="flex flex-col items-start gap-3">
            {instructions ? (
              <p className="text-sm leading-[1.6] whitespace-pre-wrap">
                {clamped}
              </p>
            ) : (
              <p className="text-muted-foreground text-[13px]">
                No instructions yet.
              </p>
            )}
            {Array.from(instructions).length > 320 ? (
              <button
                type="button"
                className="text-(--lexon-red-text) hover:underline text-[13px] font-medium"
                onClick={() => setExpanded((on) => !on)}
              >
                {expanded ? 'Show less' : 'Show more'}
              </button>
            ) : null}
          </div>
        )}
      </div>
    </DataTableCard>
  );
}

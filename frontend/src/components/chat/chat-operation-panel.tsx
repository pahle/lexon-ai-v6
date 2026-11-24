'use client';

import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useAuiState } from '@assistant-ui/react';
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  XIcon,
} from 'lucide-react';
import type {
  ChatOperationSnapshot,
  OperationAnswer,
  OperationAnswerChoice,
  OperationDecisionInput,
} from '@lexon/contracts';
import {
  useChatAwaiting,
  type ChatOperationRecord,
} from '@/components/chat/chat-runtime';
import { readDockQuestions } from '@/components/chat/chat-tool-row';
import { composerClasses } from '@/components/chat/composer-styles';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

const prettifyKey = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());

const fieldValue = (value: unknown): string => {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value)) return value.map(fieldValue).join(', ');
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${prettifyKey(k)} ${fieldValue(v)}`)
    .join(' · ');
};

const formatExpiry = (expiresAt: string | null | undefined) => {
  if (!expiresAt) return 'No expiry';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'No expiry';
  return `Expires ${new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)}`;
};

function DescriptorFields({
  input,
  display,
}: {
  readonly input: Record<string, unknown> | undefined;
  readonly display: Record<string, unknown> | undefined;
}) {
  const fields = { ...(display ?? {}), ...(input ?? {}) };
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <dl className="bg-muted flex flex-col gap-1 rounded-xl p-3">
      {entries.map(([key, value]) => (
        <div key={key} className="flex items-baseline gap-3 text-[13px]">
          <dt className="text-muted-foreground w-28 shrink-0">
            {prettifyKey(key)}
          </dt>
          <dd className="text-foreground min-w-0">{fieldValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}

const buttonClasses = {
  ghost: 'text-muted-foreground hover:text-foreground text-[13px] font-medium',
  outline:
    'border-border hover:bg-muted h-9 rounded-full border px-4 text-[13px] font-medium',
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 h-9 rounded-full px-4 text-[13px] font-medium disabled:opacity-40',
} as const;

/**
 * The docked decision panel: approvals and questions park above the composer
 * while the run waits (§9/§15). Decisions go through the owner-only §6.3
 * route via the awaiting context — never through assistant-ui's approval
 * plumbing — and the stored outcome wins over the sent action.
 */
export function ChatOperationPanel() {
  const awaiting = useChatAwaiting();
  const pendingOperationId = awaiting?.pendingOperationId;
  const part = useAuiState((state) => {
    const last = state.thread.messages.at(-1);
    if (last?.role !== 'assistant' || pendingOperationId === undefined)
      return undefined;
    return last.parts.find(
      (part) =>
        part.type === 'tool-call' &&
        (part.approval as { id?: string } | undefined)?.id ===
          pendingOperationId,
    );
  });
  const operation = awaiting?.getOperation(pendingOperationId);
  const descriptor = (
    part?.type === 'tool-call'
      ? (part.approval as { descriptor?: unknown } | undefined)?.descriptor
      : undefined
  ) as Partial<ChatOperationSnapshot> | undefined;

  const summary = useMemo<PanelSummary>(() => {
    const base: PanelSummary = {
      ...(descriptor ?? {}),
      ...(operation ?? {}),
      operationId: pendingOperationId ?? operation?.operationId,
    };
    return base;
  }, [descriptor, operation, pendingOperationId]);

  // A §9-capped frame can arrive as ids only; fetch the tree for the rest.
  const missingDetail =
    summary.input === undefined && summary.display === undefined;
  const refreshTree = awaiting?.refreshTree;
  useEffect(() => {
    if (missingDetail && pendingOperationId) refreshTree?.();
  }, [missingDetail, pendingOperationId, refreshTree]);

  if (!awaiting || pendingOperationId === undefined) return null;

  if (summary.kind === 'approval')
    return (
      <ApprovalDock
        operationId={pendingOperationId}
        summary={summary}
        awaiting={awaiting}
        missingDetail={missingDetail}
      />
    );
  return (
    <QuestionDock
      operationId={pendingOperationId}
      summary={summary}
      awaiting={awaiting}
      missingDetail={missingDetail}
    />
  );
}

type AwaitingApi = NonNullable<ReturnType<typeof useChatAwaiting>>;

/** The merged summary the dock renders — every field optional but the id. */
type PanelSummary = Omit<Partial<ChatOperationRecord>, 'operationId'> & {
  readonly operationId?: string | undefined;
};

function useDecisionSender(
  awaiting: AwaitingApi,
  operationId: string,
): [(input: OperationDecisionInput) => void, string | null, boolean] {
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const send = (input: OperationDecisionInput) => {
    if (sending) return;
    setSending(true);
    setError(null);
    void awaiting
      .decide(operationId, input)
      .then((result) => {
        if (result === null) setError('The decision could not be sent.');
      })
      .catch(() => setError('The decision could not be sent. Try again.'))
      .finally(() => setSending(false));
  };
  return [send, error, sending];
}

const approvalSummaryText = (toolName: string | undefined) =>
  toolName === 'rename_chat'
    ? 'Lexon wants to rename this chat'
    : `Lexon wants to run ${prettifyKey(toolName ?? 'this operation')}`;

function ApprovalDock({
  operationId,
  summary,
  awaiting,
  missingDetail,
}: {
  readonly operationId: string;
  readonly summary: PanelSummary;
  readonly awaiting: AwaitingApi;
  readonly missingDetail: boolean;
}) {
  const [send, error, sending] = useDecisionSender(awaiting, operationId);
  const snapshotHash = summary.snapshotHash;
  const reject = () => {
    if (snapshotHash) send({ snapshotHash, action: 'reject' });
  };
  const approve = () => {
    if (snapshotHash) send({ snapshotHash, action: 'approve' });
  };
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      reject();
    } else if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) {
      event.preventDefault();
      approve();
    } else if (event.key === 'Enter') {
      // Enter alone never approves.
      event.preventDefault();
    }
  };
  return (
    <section
      data-slot="operation-dock"
      role="status"
      aria-label="Approval needed"
      onKeyDown={onKeyDown}
      className={cn(composerClasses.wrapper, 'mb-2 pb-0! max-md:pb-0!')}
    >
      <div className="border-border bg-background flex flex-col gap-3 rounded-2xl border p-4 shadow-[0_10px_30px_-14px_rgba(8,6,6,.22),0_2px_6px_-2px_rgba(8,6,6,.06)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium">
            {approvalSummaryText(summary.toolName)}
          </h2>
        </div>
        {missingDetail ? (
          // §9-capped frames carry ids only; skeleton rows hold the field
          // slots until the tree refetch lands (LEX-DS-001 §5.1).
          <div
            aria-hidden="true"
            className="bg-muted flex flex-col gap-2 rounded-xl p-3"
          >
            <Skeleton className="w-24" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : (
          <DescriptorFields input={summary.input} display={summary.display} />
        )}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground max-md:hidden text-[13px]">
            {formatExpiry(summary.expiresAt)}
          </span>
          <span className="flex items-center gap-2">
            <button
              type="button"
              className={buttonClasses.outline}
              onClick={reject}
              disabled={sending || !snapshotHash}
              aria-keyshortcuts="Escape"
            >
              Reject
              <kbd className="text-muted-foreground ml-1.5 max-md:hidden">
                Esc
              </kbd>
            </button>
            <button
              type="button"
              className={buttonClasses.primary}
              onClick={approve}
              disabled={sending || !snapshotHash}
              aria-keyshortcuts="Control+Enter"
            >
              Approve
              <kbd className="ml-1.5 opacity-70 max-md:hidden">⌃↵</kbd>
            </button>
          </span>
        </div>
      </div>
    </section>
  );
}

function QuestionDock({
  operationId,
  summary,
  awaiting,
  missingDetail,
}: {
  readonly operationId: string;
  readonly summary: PanelSummary;
  readonly awaiting: AwaitingApi;
  readonly missingDetail: boolean;
}) {
  const [send, error, sending] = useDecisionSender(awaiting, operationId);
  const questions = useMemo(
    () => readDockQuestions(summary.input),
    [summary.input],
  );
  const [page, setPage] = useState(0);
  const [answers, setAnswers] = useState(
    () => new Map<string, OperationAnswerChoice>(),
  );
  const [checked, setChecked] = useState<ReadonlySet<number>>(new Set());
  const [textValue, setTextValue] = useState('');
  const [freeTextOpen, setFreeTextOpen] = useState(false);
  const [freeText, setFreeText] = useState('');
  const freeTextInputRef = useRef<HTMLInputElement>(null);
  const operationKeyRef = useRef(operationId);
  if (operationKeyRef.current !== operationId) {
    operationKeyRef.current = operationId;
    setPage(0);
    setAnswers(new Map());
    setChecked(new Set());
    setTextValue('');
    setFreeTextOpen(false);
    setFreeText('');
  }
  const total = questions.length;
  const current = questions[Math.min(page, Math.max(total - 1, 0))];
  const snapshotHash = summary.snapshotHash;

  const submitAnswers = (next: Map<string, OperationAnswerChoice>) => {
    if (!snapshotHash) return;
    const payload = questions.map((question): OperationAnswer => ({
      questionId: question.questionId,
      choice: next.get(question.questionId) ?? { kind: 'skipped' },
    }));
    send({ snapshotHash, action: 'answer', answers: payload });
  };
  const recordAnswer = (choice: OperationAnswerChoice) => {
    if (!current) return;
    const next = new Map(answers);
    next.set(current.questionId, choice);
    setAnswers(next);
    if (questions.every((q) => next.has(q.questionId))) {
      submitAnswers(next);
      return;
    }
    const unanswered = questions.findIndex((q) => !next.has(q.questionId));
    setPage(unanswered >= 0 ? unanswered : Math.min(page + 1, total - 1));
    setChecked(new Set());
    setTextValue('');
    setFreeTextOpen(false);
    setFreeText('');
  };
  const dismiss = () => {
    if (snapshotHash) send({ snapshotHash, action: 'dismiss' });
  };
  const nextChoice = (): OperationAnswerChoice | null => {
    if (!current) return null;
    if (current.kind === 'multiple')
      return checked.size > 0
        ? { kind: 'options', indexes: [...checked].sort((a, b) => a - b) }
        : null;
    if (current.kind === 'text')
      return textValue.trim() ? { kind: 'text', text: textValue.trim() } : null;
    return null;
  };
  const advance = () => {
    const choice = nextChoice();
    if (choice === null) return;
    recordAnswer(choice);
  };
  const selectSingle = (index: number) => {
    if (!current || current.kind !== 'single') return;
    if (index < 0 || index >= (current.options?.length ?? 0)) return;
    recordAnswer({ kind: 'option', index });
  };
  const toggleChecked = (index: number) => {
    if (!current || current.kind !== 'multiple') return;
    if (index < 0 || index >= (current.options?.length ?? 0)) return;
    setChecked((previous) => {
      const next = new Set(previous);
      if (next.has(index)) next.delete(index);
      else next.add(index);
      return next;
    });
  };
  const commitFreeText = () => {
    const text = freeText.trim();
    if (!text || !current) return;
    recordAnswer({ kind: 'text', text });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    const target = event.target as HTMLElement;
    const inField =
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement;
    if (event.key === 'Escape') {
      event.preventDefault();
      dismiss();
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      setPage((page) => Math.max(0, page - 1));
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      setPage((page) => Math.min(total - 1, page + 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (inField) {
        if (target === freeTextInputRef.current) commitFreeText();
        else advance();
      }
      return;
    }
    if (!inField && /^[1-5]$/.test(event.key)) {
      const index = Number(event.key) - 1;
      if (current?.kind === 'single') selectSingle(index);
      else if (current?.kind === 'multiple') toggleChecked(index);
    }
  };

  const isLast = total === 0 || page >= total - 1;
  const showFreeText =
    current !== undefined &&
    current.kind !== 'text' &&
    current.allowFreeText !== false;
  const isReady = !missingDetail && current !== undefined;

  return (
    <section
      data-slot="operation-dock"
      role="status"
      aria-label={
        total > 1
          ? `Question ${page + 1} of ${total} from Lexon`
          : 'A question from Lexon'
      }
      onKeyDown={onKeyDown}
      className={cn(composerClasses.wrapper, 'mb-2 pb-0! max-md:pb-0!')}
    >
      <div className="border-border bg-background flex flex-col gap-3 rounded-2xl border p-4 shadow-[0_10px_30px_-14px_rgba(8,6,6,.22),0_2px_6px_-2px_rgba(8,6,6,.06)]">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-[15px] font-medium">
            {total > 1
              ? `Question ${page + 1} of ${total} from Lexon`
              : 'A question from Lexon'}
          </h2>
          <span className="flex items-center gap-1">
            {total > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous question"
                  aria-keyshortcuts="ArrowLeft"
                  className="text-muted-foreground hover:text-foreground p-1"
                  onClick={() => setPage((page) => Math.max(0, page - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeftIcon aria-hidden="true" className="size-4" />
                </button>
                <span className="text-muted-foreground text-[13px]">
                  {page + 1} of {total}
                </span>
                <button
                  type="button"
                  aria-label="Next question"
                  aria-keyshortcuts="ArrowRight"
                  className="text-muted-foreground hover:text-foreground p-1"
                  onClick={() =>
                    setPage((page) => Math.min(total - 1, page + 1))
                  }
                  disabled={page >= total - 1}
                >
                  <ChevronRightIcon aria-hidden="true" className="size-4" />
                </button>
              </>
            ) : null}
            <button
              type="button"
              aria-label="Answer in chat instead"
              className="text-muted-foreground hover:text-foreground p-1"
              onClick={dismiss}
            >
              <XIcon aria-hidden="true" className="size-4" />
            </button>
          </span>
        </div>
        {!isReady ? (
          // Same §9-cap fallback as the approval dock: skeleton rows shaped
          // like a question and its option rows (LEX-DS-001 §5.1).
          <div aria-hidden="true" className="flex flex-col gap-3">
            <Skeleton className="h-5 w-3/4" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            <p className="text-[15px] font-medium">{current.text}</p>
            {current.kind === 'single' ? (
              <div
                role="radiogroup"
                aria-label={current.text}
                className="flex flex-col"
              >
                {current.options?.map((option, index) => {
                  const chosen =
                    answers.get(current.questionId)?.kind === 'option' &&
                    (answers.get(current.questionId) as { index?: number })
                      .index === index;
                  return (
                    <button
                      key={option.label}
                      type="button"
                      role="radio"
                      aria-checked={chosen}
                      onClick={() => selectSingle(index)}
                      className="border-border flex items-center gap-3 border-t px-1 py-2.5 text-left first:border-t-0"
                    >
                      <span
                        className={cn(
                          'flex size-6 shrink-0 items-center justify-center rounded-lg text-[13px]',
                          chosen
                            ? 'bg-(--lexon-tint) text-(--lexon-red-text)'
                            : 'bg-muted text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        {chosen ? (
                          <CheckIcon className="size-3.5" />
                        ) : (
                          index + 1
                        )}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[14.5px]">{option.label}</span>
                        {option.description ? (
                          <span className="text-muted-foreground text-[13px]">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {current.kind === 'multiple' ? (
              <div role="group" aria-label={current.text}>
                <p className="text-muted-foreground mb-1 text-[13px]">
                  Select all that apply
                </p>
                {current.options?.map((option, index) => {
                  const on = checked.has(index);
                  return (
                    <button
                      key={option.label}
                      type="button"
                      role="checkbox"
                      aria-checked={on}
                      onClick={() => toggleChecked(index)}
                      className="border-border flex items-center gap-3 border-t px-1 py-2.5 text-left first:border-t-0"
                    >
                      <span
                        className={cn(
                          'flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border',
                          on
                            ? 'border-(--lexon-red-text) bg-(--lexon-red-text) text-background'
                            : 'border-border bg-background',
                        )}
                        aria-hidden="true"
                      >
                        {on ? <CheckIcon className="size-3" /> : null}
                      </span>
                      <span className="flex min-w-0 flex-col">
                        <span className="text-[14.5px]">{option.label}</span>
                        {option.description ? (
                          <span className="text-muted-foreground text-[13px]">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  );
                })}
              </div>
            ) : null}
            {current.kind === 'text' ? (
              <input
                aria-label={current.text}
                value={textValue}
                onChange={(event) => setTextValue(event.target.value)}
                className="border-border focus:border-input bg-background h-10 w-full rounded-xl border px-3 text-[14.5px] outline-none"
                placeholder="Type your answer"
              />
            ) : null}
            {showFreeText ? (
              freeTextOpen ? (
                <input
                  ref={freeTextInputRef}
                  aria-label="Write another answer"
                  value={freeText}
                  onChange={(event) => setFreeText(event.target.value)}
                  className="border-border focus:border-input bg-background h-10 w-full rounded-xl border px-3 text-[14.5px] outline-none"
                  placeholder="Write another answer"
                  autoFocus
                />
              ) : (
                <button
                  type="button"
                  className="text-muted-foreground hover:text-foreground border-border flex items-center gap-3 border-t px-1 py-2.5 text-left text-[14.5px]"
                  onClick={() => setFreeTextOpen(true)}
                >
                  Write another answer
                </button>
              )
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="text-destructive text-sm">
            {error}
          </p>
        ) : null}
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted-foreground max-md:hidden text-[13px]">
            {formatExpiry(summary.expiresAt)}
          </span>
          <span className="flex items-center gap-3">
            {total > 1 ? (
              <button
                type="button"
                className={buttonClasses.ghost}
                onClick={() => recordAnswer({ kind: 'skipped' })}
                disabled={sending}
              >
                Skip this question
              </button>
            ) : null}
            <button
              type="button"
              className={cn(buttonClasses.ghost, 'max-md:hidden')}
              onClick={dismiss}
              disabled={sending}
            >
              Answer in chat instead
            </button>
            {isReady &&
            (current.kind === 'multiple' || current.kind === 'text') ? (
              <button
                type="button"
                className={buttonClasses.primary}
                onClick={advance}
                disabled={sending || nextChoice() === null}
              >
                {isLast ? 'Send' : 'Next'}
              </button>
            ) : null}
          </span>
        </div>
      </div>
    </section>
  );
}

'use client';

import {
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { useAuiState } from '@assistant-ui/react';
import {
  CheckIcon,
  ChevronDownIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  PencilLineIcon,
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
import { formatPlatformDateTime } from '@/components/platform/platform-format';
import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

// Descriptor labels read sentence-case ("Current title"), never Title Case.
const prettifyKey = (key: string) =>
  key
    .replace(
      /([a-z0-9])([A-Z])/g,
      (_match, lower: string, upper: string) =>
        `${lower} ${upper.toLowerCase()}`,
    )
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

// "Expires 24 Nov 2026, 10:42" — the platform date-time, viewer-local.
const formatExpiry = (expiresAt: string | null | undefined) => {
  if (!expiresAt) return 'No expiry';
  const date = new Date(expiresAt);
  if (Number.isNaN(date.getTime())) return 'No expiry';
  return `Expires ${formatPlatformDateTime(date)}`;
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
  // `.dbox` sits 12px from the dock sides with 4px above it; `.dbox .kv` is a
  // 110px label column with 16px column gap; on mobile the grid collapses to
  // stacked label/value rows with 6px under each value (prototype
  // `.app.mobile .kv { grid-template-columns: 1fr; gap: 0 }`,
  // `.kv dd { margin-bottom: 6px }`).
  return (
    <dl className="bg-muted mx-3 mt-1 flex flex-col gap-1 rounded-[10px] px-3 py-2.5 max-md:gap-0">
      {entries.map(([key, value]) => (
        <div
          key={key}
          className="flex items-baseline gap-4 text-sm max-md:flex-col max-md:gap-0"
        >
          <dt className="text-muted-foreground w-[110px] shrink-0 max-md:w-auto">
            {prettifyKey(key)}
          </dt>
          <dd
            className={cn(
              'text-foreground min-w-0 max-md:mb-1.5',
              // The proposed title is the headline value of a rename dock.
              key === 'newTitle' && 'font-semibold',
            )}
          >
            {fieldValue(value)}
          </dd>
        </div>
      ))}
    </dl>
  );
}

// The prototype's `.btn.sm`: 30px high, 10px side padding, 13px/500 text and
// the base `.btn` 8px radius — compact and rectangular, never pill-shaped.
const buttonClasses = {
  ghost:
    'text-muted-foreground hover:text-foreground inline-flex h-[30px] items-center justify-center gap-1 rounded-lg px-2.5 text-[13px] font-medium',
  outline:
    'border-border hover:bg-muted inline-flex h-[30px] items-center justify-center gap-1 rounded-lg border px-2.5 text-[13px] font-medium',
  primary:
    'bg-primary text-primary-foreground hover:bg-primary/90 inline-flex h-[30px] items-center justify-center gap-1 rounded-lg px-2.5 text-[13px] font-medium disabled:opacity-40',
} as const;

// The dock's `.dtext .inp`: a 40px field, 8px radius, `--input` border, and
// the prototype's focus ring — `--ring` border plus a 3px ring at 22%.
const dockInputClasses =
  'border-input bg-background focus:border-ring focus:ring-3 focus:ring-ring/22 h-10 w-full rounded-lg border px-3 text-[14.5px] outline-none';

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

// The `.kbd2` hint chip: a subtle currentColor wash inside the button.
const kbdClasses =
  'ml-1.5 inline-flex h-[18px] items-center rounded px-[5px] bg-[color-mix(in_srgb,currentColor_14%,transparent)] text-[11px] font-medium max-md:hidden';

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
  // "Ctrl ↵" on Windows/Linux, "⌃↵" on Apple platforms — same convention as
  // the sidebar shortcut hints.
  const [isApple, setIsApple] = useState(false);
  useEffect(() => {
    setIsApple(/^(Mac|iPhone|iPad|iPod)/.test(window.navigator.platform));
  }, []);
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
      // The dock parks inside the same padded column as the composer, so it
      // spans exactly the composer shell's width (prototype `.dock` inside
      // `.cw`); the composer wrapper's own padding must not be repeated here.
      className="mb-2 w-full"
    >
      <div className="border-border bg-background flex flex-col overflow-hidden rounded-2xl border shadow-[0_10px_30px_-14px_rgba(8,6,6,.22),0_2px_6px_-2px_rgba(8,6,6,.06)]">
        {/* `.dh` — header row, padded 12px/10px/6px/16px. */}
        <div className="flex items-center justify-between gap-3 pt-3 pr-2.5 pb-1.5 pl-4">
          <h2 className="flex items-center gap-1.5 text-[15px] font-medium">
            {approvalSummaryText(summary.toolName)}
            <ChevronDownIcon
              aria-hidden="true"
              className="text-muted-foreground size-3.5"
            />
          </h2>
        </div>
        {missingDetail ? (
          // §9-capped frames carry ids only; skeleton rows hold the field
          // slots until the tree refetch lands (LEX-DS-001 §5.1).
          <div
            aria-hidden="true"
            className="bg-muted mx-3 mt-1 flex flex-col gap-2 rounded-[10px] px-3 py-2.5"
          >
            <Skeleton className="w-24" />
            <Skeleton className="h-5 w-full" />
            <Skeleton className="h-5 w-2/3" />
          </div>
        ) : (
          <DescriptorFields input={summary.input} display={summary.display} />
        )}
        {error ? (
          <p role="alert" className="text-destructive px-4 text-sm">
            {error}
          </p>
        ) : null}
        {/* `.df` — footer, padded 6px/12px/12px/16px with the approval
            variant's 10px top padding. */}
        <div className="flex items-center justify-between gap-3 pt-2.5 pr-3 pb-3 pl-4">
          <span className="text-muted-foreground max-md:hidden text-[13px]">
            {formatExpiry(summary.expiresAt)}
          </span>
          <span className="ms-auto flex items-center gap-2">
            <button
              type="button"
              className={buttonClasses.outline}
              onClick={reject}
              disabled={sending || !snapshotHash}
              aria-keyshortcuts="Escape"
            >
              Reject
              <kbd className={cn(kbdClasses, 'text-muted-foreground')}>Esc</kbd>
            </button>
            <button
              type="button"
              className={buttonClasses.primary}
              onClick={approve}
              disabled={sending || !snapshotHash}
              aria-keyshortcuts="Control+Enter"
            >
              Approve
              <kbd className={kbdClasses}>{isApple ? '⌃↵' : 'Ctrl ↵'}</kbd>
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
  // The question text in the header labels the option group, like the
  // prototype's `aria-labelledby="aq"`.
  const questionTextId = useId();

  // The free-text row lives inside `.ol` after the option rows; like any
  // `.orow` it draws the top rule only when a row precedes it.
  const freeTextSeparator = (current?.options?.length ?? 0) > 0;
  const freeTextRow = !showFreeText ? null : freeTextOpen ? (
    <div
      className={cn(
        'border-border px-2 py-[9px]',
        freeTextSeparator && 'border-t',
      )}
    >
      <input
        ref={freeTextInputRef}
        aria-label="Write another answer"
        value={freeText}
        onChange={(event) => setFreeText(event.target.value)}
        className={dockInputClasses}
        placeholder="Write another answer"
        autoFocus
      />
    </div>
  ) : (
    // `.orow`-shaped free-text row: a pen tile then the muted prompt.
    <button
      type="button"
      className={cn(
        'border-border flex items-start gap-3 rounded-[10px] px-2 py-[9px] text-left',
        freeTextSeparator && 'rounded-t-none border-t',
      )}
      onClick={() => setFreeTextOpen(true)}
    >
      <span
        className="bg-muted text-muted-foreground mt-px flex size-6 shrink-0 items-center justify-center rounded-[7px]"
        aria-hidden="true"
      >
        <PencilLineIcon className="size-[13px]" />
      </span>
      <span className="text-muted-foreground text-[14.5px] leading-[26px]">
        Write another answer
      </span>
    </button>
  );

  return (
    <section
      data-slot="operation-dock"
      role="status"
      aria-label={
        total > 1
          ? `Question ${page + 1} of ${total} from Lexon`
          : 'Question from Lexon'
      }
      onKeyDown={onKeyDown}
      // Same width contract as the approval dock: the composer column already
      // carries the side padding, so the dock is simply full width.
      className="mb-2 w-full"
    >
      <div className="border-border bg-background flex flex-col overflow-hidden rounded-2xl border shadow-[0_10px_30px_-14px_rgba(8,6,6,.22),0_2px_6px_-2px_rgba(8,6,6,.06)]">
        {/* `.dh` — header row, padded 12px/10px/6px/16px. */}
        <div className="flex items-center justify-between gap-3 pt-3 pr-2.5 pb-1.5 pl-4">
          {/* The question text itself heads the dock; the "Question N of M"
              label stays in the DOM for assistive tech only. */}
          <h2 className="sr-only">
            {total > 1
              ? `Question ${page + 1} of ${total} from Lexon`
              : 'Question from Lexon'}
          </h2>
          {current !== undefined ? (
            <p
              id={questionTextId}
              className="min-w-0 text-[15px] leading-[1.45] font-medium"
            >
              {current.text}
            </p>
          ) : (
            <Skeleton aria-hidden="true" className="h-5 w-2/5" />
          )}
          <span className="text-muted-foreground inline-flex shrink-0 items-center gap-0.5 text-[13px] font-normal">
            {total > 1 ? (
              <>
                <button
                  type="button"
                  aria-label="Previous question"
                  aria-keyshortcuts="ArrowLeft"
                  className="hover:text-foreground flex size-7 items-center justify-center disabled:opacity-40"
                  onClick={() => setPage((page) => Math.max(0, page - 1))}
                  disabled={page === 0}
                >
                  <ChevronLeftIcon aria-hidden="true" className="size-4" />
                </button>
                <span className="min-w-11 text-center">
                  {page + 1} of {total}
                </span>
                <button
                  type="button"
                  aria-label="Next question"
                  aria-keyshortcuts="ArrowRight"
                  className="hover:text-foreground flex size-7 items-center justify-center disabled:opacity-40"
                  onClick={() =>
                    setPage((page) => Math.min(total - 1, page + 1))
                  }
                  disabled={page >= total - 1}
                >
                  <ChevronRightIcon aria-hidden="true" className="size-4" />
                </button>
                <span
                  aria-hidden="true"
                  className="bg-border mx-1 h-[18px] w-px"
                />
              </>
            ) : null}
            <button
              type="button"
              aria-label="Answer in chat instead"
              className="hover:text-foreground flex size-7 items-center justify-center"
              onClick={dismiss}
            >
              <XIcon aria-hidden="true" className="size-4" />
            </button>
          </span>
        </div>
        {!isReady ? (
          // Same §9-cap fallback as the approval dock: skeleton rows shaped
          // like a question and its option rows (LEX-DS-001 §5.1), inset
          // like the `.ol` they stand in for.
          <div
            aria-hidden="true"
            className="flex flex-col gap-3 px-2 pt-0.5 pb-1"
          >
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : (
          <>
            {current.kind === 'single' ? (
              // `.ol` — the 8px side padding insets every row separator.
              <div
                role="radiogroup"
                aria-labelledby={questionTextId}
                className="flex flex-col px-2 pt-0.5 pb-1"
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
                      // `.orow` 9px/8px padding; `.orow+.orow` draws the
                      // top rule and squares the row's top corners.
                      className={cn(
                        'border-border flex items-start gap-3 rounded-[10px] px-2 py-[9px] text-left',
                        index > 0 && 'rounded-t-none border-t',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-px flex size-6 shrink-0 items-center justify-center rounded-[7px] text-[12.5px]',
                          chosen
                            ? 'bg-(--lexon-tint) text-(--lexon-red-text)'
                            : 'bg-muted text-muted-foreground',
                        )}
                        aria-hidden="true"
                      >
                        {index + 1}
                      </span>
                      <span className="flex min-w-0 flex-col gap-px leading-[1.45]">
                        <span
                          className={cn(
                            'text-[14.5px]',
                            chosen && 'font-medium',
                          )}
                        >
                          {option.label}
                        </span>
                        {option.description ? (
                          <span className="text-muted-foreground text-[13px]">
                            {option.description}
                          </span>
                        ) : null}
                      </span>
                      {chosen ? (
                        <CheckIcon
                          aria-hidden="true"
                          className="ml-auto size-4 shrink-0 self-center text-(--lexon-red-text)"
                        />
                      ) : null}
                    </button>
                  );
                })}
                {freeTextRow}
              </div>
            ) : null}
            {current.kind === 'multiple' ? (
              <>
                {/* `.dhint` — padded like the header's 16px column. */}
                <p className="text-muted-foreground px-4 pb-1 text-[13px]">
                  Select all that apply
                </p>
                {/* `.ol` — every row carries the top rule; the first one is
                    the separator under the hint. */}
                <div
                  role="group"
                  aria-labelledby={questionTextId}
                  className="flex flex-col px-2 pt-0.5 pb-1"
                >
                  {current.options?.map((option, index) => {
                    const on = checked.has(index);
                    return (
                      <button
                        key={option.label}
                        type="button"
                        role="checkbox"
                        aria-checked={on}
                        onClick={() => toggleChecked(index)}
                        className="border-border flex items-start gap-3 rounded-[10px] rounded-t-none border-t px-2 py-[9px] text-left"
                      >
                        <span
                          className={cn(
                            'mx-[3px] mt-1 flex size-[18px] shrink-0 items-center justify-center rounded-[5px] border-[1.5px]',
                            on
                              ? 'border-(--lexon-red-text) bg-(--lexon-red-text) text-background'
                              : 'border-input bg-background',
                          )}
                          aria-hidden="true"
                        >
                          {on ? <CheckIcon className="size-3" /> : null}
                        </span>
                        <span className="flex min-w-0 flex-col gap-px leading-[1.45]">
                          <span
                            className={cn('text-[14.5px]', on && 'font-medium')}
                          >
                            {option.label}
                          </span>
                          {option.description ? (
                            <span className="text-muted-foreground text-[13px]">
                              {option.description}
                            </span>
                          ) : null}
                        </span>
                      </button>
                    );
                  })}
                  {freeTextRow}
                </div>
              </>
            ) : null}
            {current.kind === 'text' ? (
              // `.dtext` — the single answer field, padded 4px/16px/6px.
              <div className="px-4 pt-1 pb-1.5">
                <input
                  aria-label={current.text}
                  value={textValue}
                  onChange={(event) => setTextValue(event.target.value)}
                  className={dockInputClasses}
                  placeholder="Type your answer"
                  autoFocus
                />
              </div>
            ) : null}
          </>
        )}
        {error ? (
          <p role="alert" className="text-destructive px-4 text-sm">
            {error}
          </p>
        ) : null}
        {/* `.df` — footer, padded 6px/12px/12px/16px. */}
        <div className="flex items-center justify-between gap-3 pt-1.5 pr-3 pb-3 pl-4">
          <span className="text-muted-foreground max-md:hidden text-[13px]">
            {formatExpiry(summary.expiresAt)}
          </span>
          {/* `.df` keeps 4px between ghost buttons; once the expiry hides on
              mobile, footers shaped like the paged/text variants pin right
              (`margin-left:auto`), the single-question footer stays left. */}
          <span
            className={cn(
              'flex items-center gap-1',
              (total > 1 ||
                (isReady &&
                  (current.kind === 'multiple' || current.kind === 'text'))) &&
                'ms-auto',
            )}
          >
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

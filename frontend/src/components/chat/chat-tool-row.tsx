'use client';

import { useState } from 'react';
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  CircleAlertIcon,
  HourglassIcon,
  MessageCircleQuestionIcon,
  PencilLineIcon,
  WrenchIcon,
} from 'lucide-react';
import type { OperationStatus } from '@lexon/contracts';
import {
  isDecidedOperationStatus,
  useChatAwaiting,
} from '@/components/chat/chat-runtime';
import { cn } from '@/lib/utils';

/**
 * The assistant-ui tool part props as consumed here — a minimal structural
 * subset so the component stays compatible with `components.tools.Fallback`.
 */
export interface ChatToolRowProps {
  readonly toolName: string;
  readonly toolCallId: string;
  readonly args?: Record<string, unknown> | undefined;
  readonly argsText?: string | undefined;
  readonly result?: unknown;
  readonly isError?: boolean | undefined;
  readonly approval?:
    | {
        readonly id?: string | undefined;
        readonly approved?: boolean | undefined;
        readonly resolution?: string | undefined;
        readonly descriptor?: unknown;
      }
    | undefined;
}

/** §5.3 "Waiting for you" pill — tint chip with a red-text dot, polite. */
export function ChatWaitingPill() {
  return (
    <span
      role="status"
      className="inline-flex h-6 items-center gap-1.5 rounded-full bg-(--lexon-tint) px-3 text-[13px] font-medium text-(--lexon-red-text)"
    >
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-(--lexon-red-text)"
      />
      Waiting for you
    </span>
  );
}

/** The 7px primary dot a Recent item shows while a run waits. */
export function ChatWaitingDot() {
  return (
    <span
      data-slot="chat-waiting-dot"
      aria-hidden="true"
      className="bg-primary size-[7px] shrink-0 rounded-full"
    />
  );
}

const DENIED: ReadonlySet<OperationStatus> = new Set([
  'rejected',
  'dismissed',
  'expired',
]);

interface DockQuestionOption {
  readonly label: string;
  readonly description?: string;
}

export interface DockQuestion {
  readonly questionId: string;
  readonly text: string;
  readonly kind: 'single' | 'multiple' | 'text';
  readonly options?: readonly DockQuestionOption[];
  readonly allowFreeText?: boolean;
}

export function readDockQuestions(
  input: Record<string, unknown> | undefined,
): DockQuestion[] {
  const raw = input?.questions;
  if (!Array.isArray(raw)) return [];
  const questions: DockQuestion[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const candidate = item as Record<string, unknown>;
    if (
      typeof candidate.questionId !== 'string' ||
      typeof candidate.text !== 'string' ||
      (candidate.kind !== 'single' &&
        candidate.kind !== 'multiple' &&
        candidate.kind !== 'text')
    )
      continue;
    questions.push({
      questionId: candidate.questionId,
      text: candidate.text,
      kind: candidate.kind,
      ...(Array.isArray(candidate.options)
        ? {
            options: candidate.options.filter(
              (option): option is DockQuestionOption =>
                Boolean(option) &&
                typeof option === 'object' &&
                typeof (option as { label?: unknown }).label === 'string',
            ),
          }
        : {}),
      ...(candidate.allowFreeText === false ? { allowFreeText: false } : {}),
    });
  }
  return questions;
}

const TOOL_COPY: Record<
  string,
  {
    readonly running: string;
    readonly done: string;
    readonly failed: string;
    readonly rejected?: string;
    readonly dismissed?: string;
    readonly expired?: string;
  }
> = {
  deadline_calculator: {
    running: 'Calculating the deadline…',
    done: 'Calculated the deadline',
    failed: "Couldn't calculate the deadline",
    rejected: 'You rejected the calculation',
    dismissed: 'You dismissed the calculation',
    expired: 'The calculation expired',
  },
  rename_chat: {
    running: 'Renaming this chat…',
    done: 'Renamed this chat',
    failed: "Couldn't rename this chat",
    rejected: 'You rejected the rename',
    dismissed: 'You dismissed the rename',
    expired: 'Rename expired after 24 hours',
  },
  ask_user: {
    running: 'Asking you a question…',
    done: 'Asked you a question',
    failed: "Couldn't ask the question",
    rejected: 'You rejected the question',
    dismissed: 'Answered in chat',
    expired: 'The question expired unanswered',
  },
};

function toolIcon(toolName: string) {
  switch (toolName) {
    case 'deadline_calculator':
      return CalendarDaysIcon;
    case 'rename_chat':
      return PencilLineIcon;
    case 'ask_user':
      return MessageCircleQuestionIcon;
    default:
      return WrenchIcon;
  }
}

const prettifyKey = (key: string) =>
  key
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .replace(/^./, (char) => char.toUpperCase());

function fieldValue(value: unknown): string {
  if (value === null || value === undefined) return '—';
  if (typeof value === 'string' || typeof value === 'number')
    return String(value);
  if (typeof value === 'boolean') return value ? 'Yes' : 'No';
  if (Array.isArray(value))
    return value
      .map((item) =>
        item && typeof item === 'object'
          ? Object.entries(item as Record<string, unknown>)
              .map(([k, v]) => `${prettifyKey(k)} ${fieldValue(v)}`)
              .join(' · ')
          : String(item),
      )
      .join(', ');
  return Object.entries(value as Record<string, unknown>)
    .map(([k, v]) => `${prettifyKey(k)} ${fieldValue(v)}`)
    .join(' · ');
}

function FieldList({
  title,
  fields,
}: {
  readonly title: string;
  readonly fields: Record<string, unknown>;
}) {
  const entries = Object.entries(fields);
  if (entries.length === 0) return null;
  return (
    <div>
      <p className="text-muted-foreground mb-1.5 text-[13px] font-medium">
        {title}
      </p>
      <dl className="flex flex-col gap-1">
        {entries.map(([key, value]) => (
          <div key={key} className="flex items-baseline gap-3 text-[13px]">
            <dt className="text-muted-foreground shrink-0">
              {prettifyKey(key)}
            </dt>
            <dd className="text-foreground min-w-0">{fieldValue(value)}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

function answerChoiceLabel(
  question: DockQuestion | undefined,
  choice: Record<string, unknown> | undefined,
  status: OperationStatus | undefined,
): string {
  if (!choice) {
    if (status === 'expired') return 'Unanswered (expired)';
    if (status === 'dismissed') return 'Answered in chat';
    return 'Skipped';
  }
  if (choice.kind === 'skipped') return 'Skipped';
  if (choice.kind === 'text' && typeof choice.text === 'string')
    return `“${choice.text}”`;
  if (choice.kind === 'option' && typeof choice.index === 'number')
    return (
      question?.options?.[choice.index]?.label ?? `Option ${choice.index + 1}`
    );
  if (choice.kind === 'options' && Array.isArray(choice.indexes)) {
    const labels = (choice.indexes as number[]).map(
      (index) => question?.options?.[index]?.label ?? `Option ${index + 1}`,
    );
    return labels.join(', ');
  }
  return 'Answered';
}

function QuestionDecisionRecord({
  input,
  output,
  status,
}: {
  readonly input: Record<string, unknown> | undefined;
  readonly output: unknown;
  readonly status: OperationStatus | undefined;
}) {
  const questions = readDockQuestions(input);
  const stored =
    output && typeof output === 'object'
      ? (output as Record<string, unknown>)
      : undefined;
  const answers = Array.isArray(stored?.answers)
    ? (stored.answers as Array<{
        questionId?: string;
        choice?: Record<string, unknown>;
      }>)
    : undefined;
  const single =
    stored?.answered_in_chat === true
      ? 'Answered in chat'
      : status === 'expired'
        ? 'The question expired unanswered'
        : undefined;
  return (
    <div
      data-slot="decision-record"
      role="status"
      className="border-border my-1 flex max-w-[640px] flex-col gap-2.5 rounded-xl border p-3 text-sm"
    >
      {single !== undefined || questions.length === 0 ? (
        <p className="text-muted-foreground">{single ?? 'Answered in chat'}</p>
      ) : (
        questions.map((question) => {
          const answer = answers?.find(
            (entry) => entry.questionId === question.questionId,
          );
          return (
            <div key={question.questionId} className="flex flex-col gap-0.5">
              <p className="text-muted-foreground">{question.text}</p>
              <p>{answerChoiceLabel(question, answer?.choice, status)}</p>
            </div>
          );
        })
      )}
    </div>
  );
}

/**
 * LEX-DS-001 §5.3 tool row: one muted line — a 15px icon, a past-tense
 * outcome (running tools shimmer a present-tense label), the key result in
 * weight 500, a 14px chevron; expanded shows field lists, never raw JSON.
 */
export function ChatToolRow(props: ChatToolRowProps) {
  const awaiting = useChatAwaiting();
  const operation = awaiting?.getOperation(props.toolCallId);
  const status = operation?.status;
  const decided = isDecidedOperationStatus(status);
  const pending =
    props.approval !== undefined &&
    props.approval.approved === undefined &&
    props.approval.resolution === undefined &&
    props.result === undefined &&
    !decided;
  const input =
    operation?.input ??
    (props.args && typeof props.args === 'object' ? props.args : undefined);
  const output =
    operation?.output !== undefined ? operation.output : props.result;
  const isQuestion =
    props.toolName === 'ask_user' || operation?.kind === 'question';
  const [expanded, setExpanded] = useState(false);

  if (pending) return <ChatWaitingPill />;

  if (isQuestion && (decided || props.isError)) {
    return (
      <QuestionDecisionRecord input={input} output={output} status={status} />
    );
  }

  const copy = TOOL_COPY[props.toolName];
  const notRun =
    output &&
    typeof output === 'object' &&
    (output as Record<string, unknown>).not_run !== undefined;
  const failed =
    status === 'failed' ||
    status === 'outcome_unknown' ||
    (props.isError === true && !DENIED.has(status as OperationStatus));
  const deniedStatus = status !== undefined && DENIED.has(status);

  let icon = toolIcon(props.toolName);
  let label: string;
  let tone: 'default' | 'running' | 'bad' | 'muted' = 'default';
  if (notRun) {
    icon = HourglassIcon;
    label = 'Not run — the user replied in chat';
    tone = 'muted';
  } else if (deniedStatus) {
    icon = HourglassIcon;
    label =
      status === 'rejected'
        ? (copy?.rejected ?? `You rejected ${prettifyKey(props.toolName)}`)
        : status === 'dismissed'
          ? (copy?.dismissed ?? `You dismissed ${prettifyKey(props.toolName)}`)
          : (copy?.expired ?? `${prettifyKey(props.toolName)} expired`);
    tone = 'muted';
  } else if (failed) {
    icon = CircleAlertIcon;
    label = copy?.failed ?? `Couldn't finish ${prettifyKey(props.toolName)}`;
    tone = 'bad';
  } else if (!decided && props.result === undefined) {
    label = copy?.running ?? `Running ${prettifyKey(props.toolName)}…`;
    tone = 'running';
  } else {
    label = copy?.done ?? prettifyKey(props.toolName);
  }

  const keyResult =
    props.toolName === 'deadline_calculator' &&
    output &&
    typeof output === 'object'
      ? fieldValue(
          (output as Record<string, unknown>).deadline ??
            (output as Record<string, unknown>).weekday,
        )
      : undefined;
  const hasDetails =
    (input !== undefined && Object.keys(input).length > 0) ||
    (output !== undefined &&
      output !== null &&
      typeof output === 'object' &&
      Object.keys(output).length > 0);
  const Icon = icon;

  return (
    <div
      data-slot={decided || deniedStatus ? 'decision-record' : 'tool-row'}
      className="my-1 flex max-w-[640px] flex-col gap-1"
      {...(decided || deniedStatus ? { role: 'status' } : {})}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => hasDetails && setExpanded((open) => !open)}
        className={cn(
          'text-muted-foreground flex w-full items-center gap-2 text-left text-[15px] leading-[normal]',
          tone === 'bad' && 'text-(--lexon-red-text)',
          tone === 'running' && 'animate-pulse',
        )}
      >
        <Icon
          aria-hidden="true"
          className={cn(
            'size-[15px] shrink-0',
            tone === 'bad' && 'text-(--lexon-red-text)',
          )}
        />
        <span className="min-w-0 flex-1 truncate">{label}</span>
        {keyResult !== undefined && keyResult !== '—' ? (
          <span className="text-foreground shrink-0 font-medium">
            {keyResult}
          </span>
        ) : null}
        {hasDetails ? (
          <ChevronDownIcon
            aria-hidden="true"
            className={cn(
              'size-3.5 shrink-0 transition-transform',
              expanded && 'rotate-180',
            )}
          />
        ) : null}
      </button>
      {expanded && hasDetails ? (
        <div className="bg-muted flex flex-col gap-3 rounded-xl p-3">
          {input !== undefined && Object.keys(input).length > 0 ? (
            <FieldList title="Input" fields={input} />
          ) : null}
          {output !== undefined &&
          output !== null &&
          typeof output === 'object' &&
          Object.keys(output as Record<string, unknown>).length > 0 ? (
            <FieldList
              title="Result"
              fields={output as Record<string, unknown>}
            />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

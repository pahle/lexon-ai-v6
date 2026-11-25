'use client';

import { Fragment, useState, type ReactNode } from 'react';
import {
  CalendarDaysIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  CircleCheckIcon,
  CircleXIcon,
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
import {
  deadlineDateLabel,
  deadlineInputFields,
  deadlineResultFields,
  type DeadlineField,
} from '@/components/chat/deadline-format';
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

/** §5.3 "Waiting for you" pill — tint chip with a haloed red-text dot. */
export function ChatWaitingPill() {
  return (
    <span
      role="status"
      // self-start: the pill is an inline pill, not a full-width band — the
      // message column stretches its flex children, so it must opt out
      // (prototype `.wait { align-self: flex-start }`). In the history row it
      // is the tallest item, so the self-align is a no-op there.
      className="inline-flex h-6 items-center gap-[7px] self-start rounded-full bg-(--lexon-tint) pr-2.5 pl-2 text-[13px] font-medium whitespace-nowrap text-(--lexon-red-text)"
    >
      <span
        aria-hidden="true"
        className="size-2 rounded-full bg-(--lexon-red-text)"
        style={{
          boxShadow:
            '0 0 0 3px color-mix(in srgb, var(--lexon-red-text) 22%, transparent)',
        }}
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
    failed: 'Couldn’t calculate the deadline',
    rejected: 'You rejected the calculation',
    dismissed: 'You dismissed the calculation',
    expired: 'The calculation expired',
  },
  rename_chat: {
    running: 'Renaming this chat…',
    done: 'Renamed this chat',
    failed: 'Couldn’t rename this chat',
    rejected: 'You rejected the rename',
    dismissed: 'You dismissed the rename',
    expired: 'Rename expired after 24 hours',
  },
  ask_user: {
    running: 'Asking you a question…',
    done: 'Asked you a question',
    failed: 'Couldn’t ask the question',
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

// Field labels read sentence-case ("Current title"), never Title Case.
const prettifyKey = (key: string) =>
  key
    .replace(
      /([a-z0-9])([A-Z])/g,
      (_match, lower: string, upper: string) =>
        `${lower} ${upper.toLowerCase()}`,
    )
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

function genericFields(
  record: Record<string, unknown> | undefined,
): DeadlineField[] {
  if (!record) return [];
  return Object.entries(record).map(([key, value]) => ({
    label: prettifyKey(key),
    value: fieldValue(value),
  }));
}

/** One `.tsec` card of the expanded tool panel: title over a kv grid. */
function ToolSection({
  title,
  fields,
}: {
  readonly title: string;
  readonly fields: readonly DeadlineField[];
}) {
  if (fields.length === 0) return null;
  return (
    <div className="bg-muted flex flex-col rounded-xl px-3.5 pt-2.5 pb-3 text-sm leading-normal">
      <p className="text-muted-foreground mb-1.5 text-[12.5px] font-medium">
        {title}
      </p>
      <dl className="grid grid-cols-[230px_1fr] gap-x-4 gap-y-1 max-md:grid-cols-1 max-md:gap-0">
        {fields.map((field) => (
          <Fragment key={field.label}>
            <dt className="text-muted-foreground">{field.label}</dt>
            <dd
              className={cn(
                'min-w-0 max-md:mb-1.5',
                field.strong && 'font-semibold',
              )}
            >
              {field.value}
            </dd>
          </Fragment>
        ))}
      </dl>
    </div>
  );
}

function answerChoiceLabel(
  question: DockQuestion | undefined,
  choice: Record<string, unknown> | undefined,
  status: OperationStatus | undefined,
): { readonly text: string; readonly muted: boolean } {
  if (!choice) {
    if (status === 'expired')
      return { text: 'Unanswered (expired)', muted: true };
    if (status === 'dismissed')
      return { text: 'Answered in chat', muted: true };
    return { text: 'Skipped', muted: true };
  }
  if (choice.kind === 'skipped') return { text: 'Skipped', muted: true };
  if (choice.kind === 'text' && typeof choice.text === 'string')
    return { text: `“${choice.text}”`, muted: false };
  if (choice.kind === 'option' && typeof choice.index === 'number')
    return {
      text:
        question?.options?.[choice.index]?.label ??
        `Option ${choice.index + 1}`,
      muted: false,
    };
  if (choice.kind === 'options' && Array.isArray(choice.indexes)) {
    const labels = (choice.indexes as number[]).map(
      (index) => question?.options?.[index]?.label ?? `Option ${index + 1}`,
    );
    return { text: labels.join(', '), muted: false };
  }
  return { text: 'Answered', muted: false };
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
  // A dismissed question was answered in chat: every stored question gets the
  // muted "Answered in chat" line (§6.4 item 5), not just the first.
  const answeredInChat =
    status === 'dismissed' || stored?.answered_in_chat === true;
  const fallback = answeredInChat
    ? 'Answered in chat'
    : status === 'expired'
      ? 'The question expired unanswered'
      : 'Answered';
  return (
    <div
      data-slot="decision-record"
      role="status"
      className="border-border my-1 flex max-w-[640px] flex-col gap-2 rounded-xl border px-4 py-3 text-[15px] leading-[1.5]"
    >
      {questions.length === 0 ? (
        <p className="text-muted-foreground">{fallback}</p>
      ) : (
        questions.map((question) => {
          const answer = answeredInChat
            ? ({ text: 'Answered in chat', muted: true } as const)
            : answerChoiceLabel(
                question,
                answers?.find(
                  (entry) => entry.questionId === question.questionId,
                )?.choice,
                status,
              );
          return (
            <div key={question.questionId} className="flex flex-col gap-0.5">
              <p className="text-muted-foreground text-sm">{question.text}</p>
              <p className={answer.muted ? 'text-muted-foreground' : undefined}>
                {answer.text}
              </p>
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
  // A granted approval gets the neutral circle-check (the prototype's
  // `checkc`); tool icons stay for everything else.
  const approvedApproval =
    props.approval?.approved === true ||
    status === 'approved' ||
    (operation?.approvalRequired === true && decided && !deniedStatus);

  let icon = toolIcon(props.toolName);
  let label: ReactNode;
  let tone: 'default' | 'running' | 'bad' | 'muted' = 'default';
  if (notRun) {
    icon = HourglassIcon;
    label = 'Not run — the user replied in chat';
    tone = 'muted';
  } else if (deniedStatus) {
    // All three denied outcomes are the red `bad` tone; expiry keeps the
    // hourglass while rejection and dismissal get the circle-X (`xc`).
    icon = status === 'expired' ? HourglassIcon : CircleXIcon;
    label =
      status === 'rejected'
        ? (copy?.rejected ?? `You rejected ${prettifyKey(props.toolName)}`)
        : status === 'dismissed'
          ? (copy?.dismissed ?? `You dismissed ${prettifyKey(props.toolName)}`)
          : (copy?.expired ?? `${prettifyKey(props.toolName)} expired`);
    tone = 'bad';
  } else if (failed) {
    icon = CircleAlertIcon;
    label = copy?.failed ?? `Couldn’t finish ${prettifyKey(props.toolName)}`;
    tone = 'bad';
  } else if (!decided && props.result === undefined && !approvedApproval) {
    label = copy?.running ?? `Running ${prettifyKey(props.toolName)}…`;
    tone = 'running';
  } else {
    if (approvedApproval) icon = CircleCheckIcon;
    const deadline = deadlineDateLabel(output);
    label =
      props.toolName === 'deadline_calculator' && deadline !== undefined ? (
        <>
          {copy?.done ?? 'Calculated the deadline'}:{' '}
          <span className="text-foreground font-medium">{deadline}</span>
        </>
      ) : (
        (copy?.done ?? prettifyKey(props.toolName))
      );
  }

  const isDeadline = props.toolName === 'deadline_calculator';
  const inputFields = isDeadline
    ? deadlineInputFields(input)
    : genericFields(input);
  const resultFields = isDeadline
    ? deadlineResultFields(output)
    : genericFields(
        output !== null && typeof output === 'object' && !Array.isArray(output)
          ? (output as Record<string, unknown>)
          : undefined,
      );
  const hasDetails = inputFields.length > 0 || resultFields.length > 0;
  const Icon = icon;
  const Chevron = expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div
      data-slot={decided || deniedStatus ? 'decision-record' : 'tool-row'}
      className="my-1 flex max-w-[640px] flex-col gap-2.5"
      {...(decided || deniedStatus ? { role: 'status' } : {})}
    >
      <button
        type="button"
        aria-expanded={expanded}
        onClick={() => hasDetails && setExpanded((open) => !open)}
        className={cn(
          'text-muted-foreground inline-flex max-w-full items-center gap-[7px] self-start text-left text-[15px] leading-[1.5]',
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
        <span className="min-w-0 truncate">{label}</span>
        {hasDetails ? (
          <Chevron aria-hidden="true" className="size-3.5 shrink-0" />
        ) : null}
      </button>
      {expanded && hasDetails ? (
        <div className="flex flex-col gap-2">
          <ToolSection title="Input" fields={inputFields} />
          <ToolSection title="Result" fields={resultFields} />
        </div>
      ) : null}
    </div>
  );
}

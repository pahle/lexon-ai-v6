'use client';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDownIcon, ChevronRightIcon } from 'lucide-react';
import { useState } from 'react';
import { MarkdownText } from './markdown-text';
import { ThinkingIndicator } from './indicator/thinking-indicator';

export type AnswerStatus = 'running' | 'complete' | 'stopped' | 'failed';

const durationLabel = (durationMs: number) => {
  const seconds = Math.round(durationMs / 1000);
  return `Thought for ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
};

/** True while the live "Thinking…" header (animated indicator) is shown. */
export const showsThinkingLabel = (
  status: AnswerStatus,
  summary: string | null,
  durationMs: number | null,
  answerHasText: boolean,
) =>
  status === 'running' &&
  (!answerHasText || (summary === null && durationMs === null));

/**
 * The answer header: the thinking indicator (animated while the run is
 * active, the static Lexon mark otherwise) next to the F4 label rules. The
 * mark is aria-hidden and the visible "Thinking…" label is not a live region;
 * the thread's run announcer is the only one.
 */
export function PersistedReasoning({
  messageId,
  status,
  summary,
  durationMs,
  answerHasText,
}: {
  readonly messageId: string;
  readonly status: AnswerStatus;
  readonly summary: string | null;
  readonly durationMs: number | null;
  readonly answerHasText: boolean;
}) {
  const [open, setOpen] = useState(false);
  const running = status === 'running';
  const mark = (
    <span data-slot="reasoning-mark" className="inline-flex shrink-0">
      <ThinkingIndicator
        state={running ? 'running' : 'finished'}
        messageId={messageId}
      />
    </span>
  );
  if (showsThinkingLabel(status, summary, durationMs, answerHasText))
    return (
      <span className="flex items-center gap-2 text-sm leading-[1.75]">
        {mark}
        <span className="from-muted-foreground via-foreground to-muted-foreground bg-linear-to-r bg-clip-text text-transparent">
          Thinking…
        </span>
      </span>
    );
  const measured =
    durationMs !== null && answerHasText && status !== 'failed'
      ? durationLabel(durationMs)
      : null;
  if (summary === null)
    return (
      <div
        className={`text-muted-foreground flex items-center gap-2 text-sm${measured ? ' leading-[1.75]' : ''}`}
      >
        {mark}
        {measured}
      </div>
    );
  const label = measured ?? 'Reasoning';
  return (
    <Collapsible
      open={open}
      onOpenChange={setOpen}
      className="flex flex-col gap-3"
    >
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex w-fit items-center gap-2 text-sm leading-[1.75]">
        {mark}
        <span className="inline-flex items-center gap-1">
          {label}
          {open ? (
            <ChevronDownIcon className="size-3.5" />
          ) : (
            <ChevronRightIcon className="size-3.5" />
          )}
        </span>
      </CollapsibleTrigger>
      <CollapsibleContent className="border-input text-muted-foreground border-s-2 py-0.5 ps-3.5 text-sm leading-[1.6] [&_p]:m-0">
        <MarkdownText source={summary} />
      </CollapsibleContent>
    </Collapsible>
  );
}

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
      <span className="text-muted-foreground my-3 flex items-center gap-2 text-sm">
        {mark}
        Thinking…
      </span>
    );
  const measured =
    durationMs !== null && answerHasText && status !== 'failed'
      ? durationLabel(durationMs)
      : null;
  if (summary === null)
    return (
      <div className="text-muted-foreground my-3 flex items-center gap-2 text-sm">
        {mark}
        {measured}
      </div>
    );
  const label = measured ?? 'Reasoning';
  return (
    <Collapsible open={open} onOpenChange={setOpen} className="my-3">
      <CollapsibleTrigger className="text-muted-foreground hover:text-foreground flex items-center gap-2 text-sm">
        {mark}
        {label}
        {open ? (
          <ChevronDownIcon className="size-4" />
        ) : (
          <ChevronRightIcon className="size-4" />
        )}
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border text-muted-foreground ms-2 mt-2 border-s-2 ps-4 text-sm">
        <MarkdownText source={summary} />
      </CollapsibleContent>
    </Collapsible>
  );
}

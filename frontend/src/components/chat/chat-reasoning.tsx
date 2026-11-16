'use client';

import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from '@/components/ui/collapsible';
import { ChevronDownIcon } from 'lucide-react';
import { useState } from 'react';
import { MarkdownText } from './markdown-text';
import { ThinkingIndicator } from './indicator/thinking-indicator';

export type AnswerStatus = 'running' | 'complete' | 'stopped' | 'failed';

const durationLabel = (durationMs: number) => {
  const seconds = Math.round(durationMs / 1000);
  return `Thought for ${seconds} ${seconds === 1 ? 'second' : 'seconds'}`;
};

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
  if (running && (!answerHasText || (summary === null && durationMs === null)))
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
        <ChevronDownIcon className="size-4 transition-transform motion-reduce:transition-none" />
      </CollapsibleTrigger>
      <CollapsibleContent className="border-border text-muted-foreground mt-2 border-s-2 ps-4 text-sm">
        <MarkdownText source={summary} />
      </CollapsibleContent>
    </Collapsible>
  );
}

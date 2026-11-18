'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { cn } from '@/lib/utils';
import {
  STARTER_TEMPLATES,
  insertTemplate,
  type TextRange,
} from '@/lib/starter-templates';

type StarterPillsProps = {
  readonly textareaRef: RefObject<HTMLTextAreaElement | null>;
  readonly value: string;
  readonly onValueChange: (value: string) => void;
  readonly disabled?: boolean;
};

export function StarterPills({
  textareaRef,
  value,
  onValueChange,
  disabled = false,
}: StarterPillsProps) {
  const pending = useRef<{ text: string; selection: TextRange | null } | null>(
    null,
  );

  // Apply focus and selection once React has committed the new value.
  useLayoutEffect(() => {
    const next = pending.current;
    const textarea = textareaRef.current;
    if (!next || !textarea || next.text !== value) return;
    pending.current = null;
    textarea.focus();
    if (next.selection)
      textarea.setSelectionRange(next.selection.start, next.selection.end);
  }, [textareaRef, value]);

  return (
    <div
      role="group"
      aria-label="Starter prompts"
      className="flex flex-nowrap justify-center gap-2 max-md:flex-wrap max-md:px-4"
    >
      {STARTER_TEMPLATES.map((item) => {
        // The chosen pill is the one whose template is in the composer.
        const chosen = value.includes(item.template);
        return (
          <button
            key={item.label}
            type="button"
            aria-pressed={chosen}
            className={cn(
              'hover:bg-accent text-foreground focus-visible:ring-ring/50 rounded-full border px-3.5 py-2 text-sm outline-none focus-visible:ring-3 disabled:pointer-events-none disabled:opacity-50',
              chosen
                ? 'border-foreground bg-muted'
                : 'border-border bg-background',
            )}
            disabled={disabled}
            onClick={() => {
              const next = insertTemplate(value, item.template);
              pending.current = next;
              onValueChange(next.text);
            }}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

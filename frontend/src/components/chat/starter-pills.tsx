'use client';

import { useLayoutEffect, useRef, type RefObject } from 'react';
import { Button } from '@/components/ui/button';
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
      className="mt-3 flex flex-wrap justify-center gap-2"
    >
      {STARTER_TEMPLATES.map((item) => (
        <Button
          key={item.label}
          type="button"
          variant="outline"
          size="sm"
          className="rounded-full"
          disabled={disabled}
          onClick={() => {
            const next = insertTemplate(value, item.template);
            pending.current = next;
            onValueChange(next.text);
          }}
        >
          {item.label}
        </Button>
      ))}
    </div>
  );
}

// Class strings shared by the new chat form (chat-view.tsx) and the thread
// composer (thread.aui.tsx). Presentation only: each composer keeps its own
// logic. LEX-DS-001 §5.3: 880px wide, 20px radius, soft elevation.
export const composerClasses = {
  shell:
    'border-foreground/10 focus-within:border-ring focus-within:ring-3 focus-within:ring-ring/50 bg-background mx-auto flex w-full max-w-[880px] cursor-text flex-col gap-2 rounded-[20px] border p-3 shadow-lg shadow-foreground/5 transition-[border-color,box-shadow]',
  input:
    'placeholder:text-muted-foreground/60 max-h-48 min-h-10 w-full resize-none bg-transparent px-2.5 py-1 text-base leading-6 outline-none',
  toolbar: 'flex flex-nowrap items-center justify-between gap-3',
  deepThinking: 'shrink-0 rounded-full whitespace-nowrap',
  deepThinkingPressed:
    'bg-(--lexon-tint) text-(--lexon-red-text) hover:bg-(--lexon-tint)',
  send: 'size-9 shrink-0 rounded-full',
  // ChatComposerCancel wraps the render element in a second Button, whose
  // default size and radius are appended after these classes; the important
  // modifier keeps the Stop control round and 36px.
  stop: 'size-9! shrink-0 rounded-full!',
} as const;

// Class strings shared by the new chat form (chat-view.tsx) and the thread
// composer (thread.aui.tsx). Presentation only: each composer keeps its own
// logic. LEX-DS-001 v3.1 §5.5 Composer: 880px wide, 20px radius, 1px border,
// padding 16px 14px 12px 16px, 10px gap, soft elevation.
// The text area grows with its content from 56px to 200px (mobile 144px), then
// scrolls inside; typed text is never clipped.
export const composerClasses = {
  // The wrapper of the box and the disclaimer: padding 0 24px 14px, mobile
  // 10px 14px 12px. The 880px includes the 24px side padding.
  wrapper:
    'relative mx-auto w-full max-w-[880px] px-6 pb-3.5 max-md:px-3.5 max-md:pt-2.5 max-md:pb-3',
  shell:
    'border-border focus-within:border-input bg-background mx-auto flex w-full max-w-[880px] cursor-text flex-col gap-2.5 rounded-[20px] border pt-4 pr-3.5 pb-3 pl-4 shadow-[0_10px_30px_-14px_rgba(8,6,6,.22),0_2px_6px_-2px_rgba(8,6,6,.06)] transition-[border-color]',
  input:
    'placeholder:text-muted-foreground max-h-[200px] max-md:max-h-36 overflow-y-auto min-h-14 w-full resize-none bg-transparent dark:bg-transparent p-1 text-base leading-6 outline-none',
  toolbar: 'flex flex-nowrap items-center justify-between gap-3',
  // 32px high, fully round, 13px weight 500, transparent border; pressed is
  // the tint background with a red-text border and label.
  deepThinking:
    'h-8 shrink-0 gap-1.5 rounded-full border-transparent bg-transparent px-2.5 text-[13px] font-medium whitespace-nowrap text-muted-foreground hover:bg-transparent dark:bg-transparent dark:hover:bg-transparent',
  deepThinkingPressed:
    'border-(--lexon-red-text) bg-(--lexon-tint) text-(--lexon-red-text) hover:bg-(--lexon-tint) dark:bg-(--lexon-tint) dark:hover:bg-(--lexon-tint)',
  disclaimer: 'text-muted-foreground mt-2 text-center text-xs',
  send: 'size-9 shrink-0 rounded-full disabled:opacity-40 [&_svg]:size-[18px]',
  // ChatComposerCancel wraps the render element in a second Button, whose
  // default size and radius are appended after these classes; the important
  // modifier keeps the Stop control round and 36px.
  stop: 'size-9! shrink-0 rounded-full!',
} as const;

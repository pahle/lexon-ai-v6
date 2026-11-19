import { Skeleton } from '@/components/ui/skeleton';

/**
 * Thread loading (LEX-DS-001 v3.1 §5.5): a 44px bubble at 55% width on the
 * right, then four 12px lines. The thread's 32px turn gap (22px on mobile)
 * separates the two blocks.
 */
export function ChatSkeleton({ className }: { readonly className?: string }) {
  return (
    <div
      data-slot="aui_thread-history-skeleton"
      role="status"
      className={`flex flex-col gap-8 max-md:gap-[22px] ${className ?? ''}`}
    >
      <span className="sr-only">Loading conversation</span>
      <Skeleton className="ml-auto h-11 w-[55%] rounded-2xl motion-reduce:animate-none" />
      <div className="flex flex-col gap-2.5">
        <Skeleton className="w-[30%] motion-reduce:animate-none" />
        <Skeleton className="w-[90%] motion-reduce:animate-none" />
        <Skeleton className="w-[75%] motion-reduce:animate-none" />
        <Skeleton className="w-[82%] motion-reduce:animate-none" />
      </div>
    </div>
  );
}

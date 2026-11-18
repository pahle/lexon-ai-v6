import type { ReactNode } from 'react';
import { Button } from '../ui/button';
import { Skeleton } from '../ui/skeleton';

/**
 * Skeleton rows shaped like the content that loads: a title, then label and
 * control rows. The message is the accessible name only; no loading text is
 * shown (LEX-DS-001 §5.1).
 */
export function LoadingState({
  message = 'Loading page',
}: {
  message?: string | undefined;
}) {
  return (
    <section
      className="flex flex-col gap-2 p-6"
      role="status"
      aria-live="polite"
      data-slot="loading-state"
    >
      <span className="sr-only">{message}</span>
      <Skeleton aria-hidden="true" className="mb-4 h-6 w-40" />
      {[0, 1, 2].map((row) => (
        <div key={row} className="flex flex-col gap-2 pb-4" aria-hidden="true">
          <Skeleton className="w-24" />
          <Skeleton className="h-9 w-full max-w-md" />
        </div>
      ))}
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
  headingLevel = 2,
}: {
  title: string;
  description: string;
  action?: ReactNode;
  headingLevel?: 2 | 3;
}) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className="flex flex-col gap-2 p-6">
      <Heading className="text-xl font-semibold">{title}</Heading>
      <p className="text-sm text-muted-foreground">{description}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </section>
  );
}

export function ErrorState({
  message = 'Unable to load this page. Please try again.',
  onRetry,
}: {
  message?: string | undefined;
  onRetry?: (() => void) | undefined;
}) {
  return (
    <section className="flex flex-col gap-2 p-6" role="alert">
      <p>{message}</p>
      {onRetry ? (
        <Button variant="outline" onClick={onRetry}>
          Try again
        </Button>
      ) : null}
    </section>
  );
}

export function NoAccessState({
  message = 'You do not have access to this page.',
  action,
}: {
  message?: string | undefined;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 p-6" role="alert">
      <p>{message}</p>
      {action ? <div className="pt-2">{action}</div> : null}
    </section>
  );
}

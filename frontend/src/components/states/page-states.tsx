import type { ReactNode } from 'react';
import { Button } from '../ui/button';

export function LoadingState({
  message = 'Loading…',
}: {
  message?: string | undefined;
}) {
  return (
    <section
      className="flex flex-col gap-2 p-6"
      role="status"
      aria-live="polite"
    >
      <p>{message}</p>
    </section>
  );
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <section className="flex flex-col gap-2 p-6">
      <h2 className="text-xl font-semibold">{title}</h2>
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
}: {
  message?: string | undefined;
}) {
  return (
    <section className="flex flex-col gap-2 p-6" role="alert">
      <p>{message}</p>
    </section>
  );
}

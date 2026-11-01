'use client';

import { ErrorState } from '../components/states/page-states';

export default function RootError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <h1 className="mb-4 text-[length:var(--font-size-heading)] font-semibold">
        Something went wrong
      </h1>
      <ErrorState onRetry={retry} />
    </main>
  );
}

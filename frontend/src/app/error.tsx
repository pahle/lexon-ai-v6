'use client';

import { ErrorState } from '../components/states/page-states';
import Link from 'next/link';

export default function RootError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <>
      <a
        className="sr-only inline-flex min-h-11 items-center focus:not-sr-only"
        href="#main"
      >
        Skip to content
      </a>
      <main id="main" tabIndex={-1} className="mx-auto max-w-2xl p-6">
        <h1 className="mb-4 text-[length:var(--font-size-heading)] font-semibold">
          Something went wrong
        </h1>
        <ErrorState onRetry={retry} />
        <Link
          className="inline-flex min-h-11 items-center underline"
          href="/workspace"
        >
          Return to workspace
        </Link>
      </main>
    </>
  );
}

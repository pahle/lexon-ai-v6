'use client';

import { ErrorState } from '../../components/states/page-states';
import { PageHeader } from '../../components/shell/page-header';
import Link from 'next/link';

export default function WorkspaceError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <div className="flex flex-col gap-6">
      <PageHeader title="Something went wrong" />
      <ErrorState onRetry={retry} />
      <Link
        className="inline-flex min-h-11 items-center underline"
        href="/workspace"
      >
        Return to workspace
      </Link>
    </div>
  );
}

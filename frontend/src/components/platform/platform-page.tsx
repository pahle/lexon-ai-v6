'use client';

import type { ReactNode } from 'react';
import { useWorkspace } from '../shell/workspace-provider';
import { PageHeader } from '../shell/page-header';
import { NoAccessState } from '../states/page-states';

export function PlatformPage({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  const { identity } = useWorkspace();
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-6">
      <PageHeader title={title} />
      {identity?.platformAdmin ? children : <NoAccessState />}
    </div>
  );
}

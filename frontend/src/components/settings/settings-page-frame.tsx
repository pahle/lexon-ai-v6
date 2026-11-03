import type { ReactNode } from 'react';
import { PageHeader } from '../shell/page-header';

export function SettingsPageFrame({
  title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6">
      <PageHeader title={title} />
      {children}
    </div>
  );
}

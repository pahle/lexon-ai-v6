import type { ReactNode } from 'react';
import { PageHeader } from '../shell/page-header';

export function OrganizationSettingsPageFrame({
  children,
}: {
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex w-full max-w-2xl min-w-0 flex-col gap-6">
      <PageHeader title="Organization settings" />
      {children}
    </div>
  );
}

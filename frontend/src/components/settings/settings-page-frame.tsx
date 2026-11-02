import type { ReactNode } from 'react';
import { PageHeader } from '../shell/page-header';
import { SectionNavigation } from './section-navigation';

export function SettingsPageFrame({
  title,
  items,
  children,
}: {
  title: string;
  items: readonly { href: string; label: string; current: boolean }[];
  children: ReactNode;
}) {
  return (
    <div className="mx-auto flex max-w-2xl min-w-0 flex-col gap-6">
      <PageHeader title={title} />
      <SectionNavigation items={items} />
      {children}
    </div>
  );
}

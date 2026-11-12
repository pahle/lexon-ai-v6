import Link from 'next/link';
import { PageHeader } from '@/components/shell/page-header';
import { Button } from '@/components/ui/button';

export function WorkspaceNotFound() {
  return (
    <section className="flex min-h-0 flex-1 flex-col gap-4">
      <PageHeader title="Page not found" />
      <p>This page could not be found.</p>
      <Button className="w-fit" render={<Link href="/workspace" />}>
        New chat
      </Button>
    </section>
  );
}

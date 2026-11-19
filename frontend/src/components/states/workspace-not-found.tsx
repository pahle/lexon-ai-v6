'use client';

import { CompassIcon, UsersIcon } from 'lucide-react';
import { usePathname } from 'next/navigation';
import { StatusPage } from './status-page';

// Organization routes that do not exist show the prototype's "Workspace not
// found" state; every other in-shell miss is the generic page.
export function WorkspaceNotFound() {
  const pathname = usePathname() ?? '';
  if (pathname === '/organizations' || pathname.startsWith('/organizations/'))
    return (
      <StatusPage
        icon={<UsersIcon />}
        title="Workspace not found"
        text="This organization does not exist, or you are no longer a member."
        action={{ label: 'Go to my workspace', href: '/workspace' }}
      />
    );
  return (
    <StatusPage
      icon={<CompassIcon />}
      title="Page not found"
      text="The page you are looking for does not exist or has moved."
      action={{ label: 'Return to workspace', href: '/workspace' }}
    />
  );
}

'use client';

import type { ReactNode } from 'react';
import { LockIcon } from 'lucide-react';
import { useWorkspace } from '../shell/workspace-provider';
import { StatusPage } from '../states/status-page';

/**
 * The platform console gate. Anyone who is not a platform administrator sees
 * the shared no-access status page; the console content (and its data
 * loaders) never mounts for them.
 */
export function PlatformPage({ children }: { children: ReactNode }) {
  const { identity } = useWorkspace();
  if (!identity?.platformAdmin)
    return (
      <StatusPage
        role="alert"
        icon={<LockIcon />}
        title="You do not have access"
        text="This page is available to platform administrators only."
        action={{ label: 'Go to my workspace', href: '/workspace' }}
      />
    );
  return children;
}

import type { ReactNode } from 'react';
import { WorkspaceProvider } from '../../components/shell/workspace-provider';
import { WorkspaceShell } from '../../components/shell/workspace-shell';
import { loadWorkspaceBootstrap } from '../../lib/workspace-bootstrap';

export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

export default async function WorkspaceLayout({
  children,
}: {
  children: ReactNode;
}) {
  const bootstrap = await loadWorkspaceBootstrap();
  return (
    <WorkspaceProvider bootstrap={bootstrap}>
      <WorkspaceShell>{children}</WorkspaceShell>
    </WorkspaceProvider>
  );
}

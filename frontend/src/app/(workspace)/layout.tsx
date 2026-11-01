import type { ReactNode } from 'react';
import { cookies } from 'next/headers';
import { WorkspaceProvider } from '../../components/shell/workspace-provider';
import { WorkspaceShell } from '../../components/shell/workspace-shell';
import { AppSidebar } from '../../components/shell/app-sidebar';
import { SidebarProvider } from '../../components/ui/sidebar';
import { TooltipProvider } from '../../components/ui/tooltip';
import { sidebarDefaultOpen } from '../../components/shell/sidebar-cookie';
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
  const sidebarCookie = (await cookies()).get('sidebar_state')?.value;
  return (
    <WorkspaceProvider bootstrap={bootstrap}>
      <TooltipProvider>
        <SidebarProvider defaultOpen={sidebarDefaultOpen(sidebarCookie)}>
          <WorkspaceShell sidebar={<AppSidebar />}>{children}</WorkspaceShell>
        </SidebarProvider>
      </TooltipProvider>
    </WorkspaceProvider>
  );
}

'use client';

import {
  createContext,
  useContext,
  type ComponentProps,
  type ReactNode,
} from 'react';
import { SidebarProvider, useSidebar } from '../ui/sidebar';

type SidebarState = ReturnType<typeof useSidebar>;
type SidebarProviderProps = ComponentProps<typeof SidebarProvider>;
const OptionalSidebarContext = createContext<SidebarState | undefined>(
  undefined,
);

function SidebarContextBridge({ children }: { children: ReactNode }) {
  const sidebar = useSidebar();
  return (
    <OptionalSidebarContext.Provider value={sidebar}>
      {children}
    </OptionalSidebarContext.Provider>
  );
}

export function CompositeSidebarProvider({
  children,
  ...props
}: SidebarProviderProps) {
  return (
    <SidebarProvider {...props}>
      <SidebarContextBridge>{children}</SidebarContextBridge>
    </SidebarProvider>
  );
}

export function useOptionalSidebar(): SidebarState | undefined {
  return useContext(OptionalSidebarContext);
}

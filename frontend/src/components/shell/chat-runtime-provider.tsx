'use client';
import {
  AssistantRuntimeProvider,
  useLocalRuntime,
  type ChatModelAdapter,
} from '@assistant-ui/react';
import { useMemo, type ReactNode } from 'react';

export const inertChatModelAdapter: ChatModelAdapter = {
  run: async () => {
    throw new Error('Chat is not available yet.');
  },
};

function TenantRuntime({ children }: { children: ReactNode }) {
  const adapter = useMemo(() => inertChatModelAdapter, []);
  const runtime = useLocalRuntime(adapter, { initialMessages: [] });
  return (
    <AssistantRuntimeProvider runtime={runtime}>
      {children}
    </AssistantRuntimeProvider>
  );
}

export function ChatRuntimeProvider({
  tenantId,
  children,
}: {
  tenantId: string;
  children: ReactNode;
}) {
  return <TenantRuntime key={tenantId}>{children}</TenantRuntime>;
}

'use client';

import { useMemo } from 'react';
import { notFound, useParams } from 'next/navigation';
import { ChatView } from '@/components/chat/chat-view';
import { LoadingState } from '@/components/states/page-states';
import { PageHeader } from '@/components/shell/page-header';
import { useWorkspace } from '@/components/shell/workspace-provider';
import { createChatClient } from '@/lib/chat-client';

export default function ChatPage() {
  const { chatId } = useParams<{ chatId: string }>();
  const { identity } = useWorkspace();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  if (!identity) return <LoadingState message="Verifying your workspace…" />;
  if (!identity.user.onboardingCompleted)
    return <LoadingState message="Opening onboarding…" />;
  if (!/^[0-9a-f-]{36}$/i.test(chatId)) notFound();
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="Chat" visuallyHidden />
      <ChatView
        chatId={chatId}
        actorScope={`${identity.organization.id}:${identity.user.id}`}
        client={client}
        displayName={identity.user.name}
        orgId={identity.organization.id}
        userId={identity.user.id}
      />
    </div>
  );
}

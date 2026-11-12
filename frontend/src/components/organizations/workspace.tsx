'use client';
import { useEffect, useMemo } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../shell/workspace-provider';
import { PageHeader } from '../shell/page-header';
import { LoadingState } from '../states/page-states';
import { ChatView } from '../chat/chat-view';
import { createChatClient } from '@/lib/chat-client';

export function Workspace() {
  const router = useRouter();
  const { identity } = useWorkspace();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  useEffect(() => {
    if (identity && !identity.user.onboardingCompleted)
      router.replace('/onboarding');
  }, [identity, router]);
  if (!identity) return <LoadingState message="Verifying your workspace…" />;
  if (!identity.user.onboardingCompleted)
    return <LoadingState message="Opening onboarding…" />;
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <PageHeader title="New chat" visuallyHidden />
      <ChatView
        actorScope={`${identity.organization.id}:${identity.user.id}`}
        client={client}
        displayName={identity.user.name}
        orgId={identity.organization.id}
        userId={identity.user.id}
      />
    </div>
  );
}

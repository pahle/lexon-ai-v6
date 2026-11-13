'use client';
import { useEffect, useMemo } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useWorkspace } from '../shell/workspace-provider';
import { PageHeader } from '../shell/page-header';
import { LoadingState } from '../states/page-states';
import { ChatView } from '../chat/chat-view';
import { createChatClient } from '@/lib/chat-client';
import { readSettingsSection } from '../settings/settings-url';

export function Workspace() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const settingsSection = readSettingsSection(
    new URLSearchParams(searchParams.toString()),
  );
  const { identity } = useWorkspace();
  const client = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  useEffect(() => {
    if (
      identity &&
      !identity.user.onboardingCompleted &&
      settingsSection !== 'security'
    )
      router.replace('/onboarding');
  }, [identity, router, settingsSection]);
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

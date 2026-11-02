'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../shell/workspace-provider';
import { PageHeader } from '../shell/page-header';
import { LoadingState } from '../states/page-states';
import { Thread } from '../assistant-ui/elements/thread.aui';

export function Workspace() {
  const router = useRouter();
  const { identity } = useWorkspace();
  useEffect(() => {
    if (identity && !identity.user.onboardingCompleted)
      router.replace('/onboarding');
  }, [identity, router]);
  if (!identity) return <LoadingState message="Verifying your workspace…" />;
  if (!identity.user.onboardingCompleted)
    return <LoadingState message="Opening onboarding…" />;
  return (
    <div className="flex min-h-[calc(100svh-8rem)] flex-col gap-6">
      <PageHeader title="Home" />
      <Thread displayName={identity.user.name} />
    </div>
  );
}

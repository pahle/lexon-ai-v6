'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../shell/workspace-provider';
import { PageHeader } from '../shell/page-header';
import { LoadingState } from '../states/page-states';

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
  return <PageHeader title="Home" />;
}

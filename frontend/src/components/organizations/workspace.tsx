'use client';
import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useWorkspace } from '../shell/workspace-provider';
import { PageHeader } from '../shell/page-header';

export function Workspace() {
  const router = useRouter();
  const { identity } = useWorkspace();
  useEffect(() => {
    if (identity && !identity.user.onboardingCompleted)
      router.replace('/onboarding');
  }, [identity, router]);
  if (!identity) return <p role="status">Verifying your workspace…</p>;
  if (!identity.user.onboardingCompleted)
    return <p role="status">Opening onboarding…</p>;
  return <PageHeader title="Home" />;
}

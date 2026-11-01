'use client';
import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { authClient } from '../../lib/auth-client';
import { OrganizationSwitcher } from './organization-switcher';
import { identityApi, QueryFailure, useCursorPage } from './page-state';
import { AuthCard } from '../auth/auth-card';
import { CreateTeam } from './create-team';
import { Button } from '../ui/button';
import { useWorkspace } from '../shell/workspace-provider';
export function Workspace() {
  const query = useQueryClient();
  const router = useRouter();
  const { identity } = useWorkspace();
  const orgs = useCursorPage(
    ['organizations'],
    (cursor) =>
      identityApi.listOrganizations({
        limit: 20,
        ...(cursor ? { cursor } : {}),
      }),
    !!identity && identity.user.onboardingCompleted,
  );
  const [signingOut, setSigningOut] = useState(false);
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    if (identity && !identity.user.onboardingCompleted)
      router.replace('/onboarding');
  }, [identity, router]);
  if (orgs.query.error) return <QueryFailure error={orgs.query.error} />;
  if (!identity) return <p role="status">Verifying your workspace…</p>;
  if (!identity.user.onboardingCompleted)
    return <p role="status">Opening onboarding…</p>;
  if (signingOut) return <p role="status">Updating your workspace…</p>;
  return (
    <div className="flex flex-col gap-6">
      <OrganizationSwitcher
        key={identity.organization.id}
        current={identity.organization}
        organizations={orgs.query.data?.items ?? [identity.organization]}
      />
      {orgs.pagination}
      <AuthCard title="Create a team">
        <CreateTeam
          onCreated={async () => {
            await query.invalidateQueries({ queryKey: ['organizations'] });
          }}
        />
      </AuthCard>
      <a href="/account/security">Account security</a>
      <Button
        variant="outline"
        onClick={async () => {
          setSigningOut(true);
          try {
            await query.cancelQueries();
            query.clear();
            const result = await authClient.signOut();
            if (result.error) throw new Error();
            window.location.replace('/sign-in');
          } catch {
            setFailure(true);
            setSigningOut(false);
          }
        }}
      >
        Sign out
      </Button>
      {failure ? (
        <p role="alert">Unable to sign out. Please try again.</p>
      ) : null}
    </div>
  );
}

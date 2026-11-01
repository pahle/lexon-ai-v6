'use client';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IdentitySummary } from '@lexon/contracts';
import { authClient } from '../../lib/auth-client';
import { transitionTenant } from '../../lib/tenant-queries';
import { OrganizationSwitcher } from './organization-switcher';
import { identityApi, QueryFailure, useCursorPage } from './page-state';
import { AuthCard } from '../auth/auth-card';
import { CreateTeam } from './create-team';
import { Button } from '../ui/button';
export function Workspace({ initial }: { initial: IdentitySummary }) {
  const query = useQueryClient();
  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: () => identityApi.identity(),
    initialData: initial,
    refetchInterval: 5000,
    retry: false,
  });
  const orgs = useCursorPage(['organizations'], (cursor) =>
    identityApi.listOrganizations({ limit: 20, ...(cursor ? { cursor } : {}) }),
  );
  const [committed, setCommitted] = useState(initial.organization.id);
  const [signingOut, setSigningOut] = useState(false);
  const [failure, setFailure] = useState(false);
  useEffect(() => {
    if (identity.data.organization.id !== committed)
      void transitionTenant(query, identity.data.organization).then(
        async () => {
          await query.invalidateQueries({ queryKey: ['organizations'] });
          setCommitted(identity.data.organization.id);
        },
      );
  }, [identity.data.organization, committed, query]);
  if (identity.error || orgs.query.error)
    return <QueryFailure error={identity.error ?? orgs.query.error} />;
  if (signingOut || committed !== identity.data.organization.id)
    return <p role="status">Updating your workspace…</p>;
  return (
    <div className="flex flex-col gap-6">
      {identity.data.fallbackReason ? (
        <p role="status">
          You no longer have access to the previous organization. Personal is
          selected.
        </p>
      ) : null}
      <OrganizationSwitcher
        key={identity.data.organization.id}
        current={identity.data.organization}
        organizations={orgs.query.data?.items ?? [identity.data.organization]}
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

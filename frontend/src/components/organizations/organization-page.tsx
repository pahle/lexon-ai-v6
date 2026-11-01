'use client';
import { useEffect } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { identityApi, QueryFailure } from './page-state';
import { transitionTenant } from '../../lib/tenant-queries';
import { Members } from './members';
import { Invitations } from './invitations';
import { OrganizationSettings } from './organization-settings';
export function OrganizationPage({
  organizationId,
  view,
}: {
  organizationId: string;
  view: 'members' | 'invitations' | 'settings';
}) {
  const query = useQueryClient();
  const identity = useQuery({
    queryKey: ['identity'],
    queryFn: () => identityApi.identity(),
    refetchInterval: 5000,
    retry: false,
  });
  const org = identity.data?.organization;
  const lost = !!org && org.id !== organizationId;
  useEffect(() => {
    if (lost && org) void transitionTenant(query, org);
  }, [lost, org, query]);
  if (identity.error) return <QueryFailure error={identity.error} />;
  if (!org) return <p role="status">Loading organization…</p>;
  if (lost)
    return (
      <section>
        <p role="status">
          You no longer have access to this organization in the current
          workspace.{' '}
          {org.kind === 'personal'
            ? 'Personal is selected.'
            : 'Return to your selected organization.'}
        </p>
        <a href="/workspace">Return to workspace</a>
      </section>
    );
  return (
    <div className="flex flex-col gap-6">
      <a href="/workspace">Return to workspace</a>
      {view === 'members' ? (
        <Members organization={org} />
      ) : view === 'invitations' ? (
        <Invitations organization={org} />
      ) : (
        <OrganizationSettings organization={org} />
      )}
    </div>
  );
}

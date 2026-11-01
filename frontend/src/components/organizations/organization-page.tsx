'use client';
import { useLayoutEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../shell/workspace-provider';
import { Members } from './members';
import { Invitations } from './invitations';
import { OrganizationSettings } from './organization-settings';
import { LoadingState, NoAccessState } from '../states/page-states';
export function OrganizationPage({
  organizationId,
  view,
}: {
  organizationId: string;
  view: 'members' | 'invitations' | 'general';
}) {
  const queryClient = useQueryClient();
  const { identity } = useWorkspace();
  const org = identity?.organization;
  const lost = !!org && org.id !== organizationId;
  const allowed =
    !!org &&
    org.id === organizationId &&
    org.kind === 'team' &&
    (view !== 'invitations' || org.role !== 'member') &&
    (view !== 'general' || org.role === 'owner');
  useLayoutEffect(() => {
    if (allowed) return;
    const queryKey = ['tenant', organizationId];
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [allowed, organizationId, queryClient]);
  if (!org) return <LoadingState message="Loading organization…" />;
  if (lost)
    return (
      <NoAccessState message="This organization is not selected in the current workspace." />
    );
  if (!allowed)
    return (
      <NoAccessState message="You do not have access to this organization setting." />
    );
  return (
    <div className="flex flex-col gap-6">
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

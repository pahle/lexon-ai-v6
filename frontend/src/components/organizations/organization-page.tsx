'use client';

import { useLayoutEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useWorkspace } from '../shell/workspace-provider';
import { Members } from './members';
import { Invitations } from './invitations';
import { OrganizationSettings } from './organization-settings';
import { LoadingState, NoAccessState } from '../states/page-states';

export function OrganizationPage({
  view,
}: {
  view: 'members' | 'invitations' | 'general';
}) {
  const queryClient = useQueryClient();
  const { identity } = useWorkspace();
  const organization = identity?.organization;
  const allowed =
    !!organization &&
    organization.kind === 'team' &&
    (view !== 'invitations' || organization.role !== 'member') &&
    (view !== 'general' || organization.role === 'owner');

  useLayoutEffect(() => {
    if (allowed || !organization) return;
    const queryKey = ['tenant', organization.id];
    void queryClient.cancelQueries({ queryKey });
    queryClient.removeQueries({ queryKey });
  }, [allowed, organization, queryClient]);

  if (!organization) return <LoadingState message="Loading organization…" />;
  if (!allowed)
    return (
      <NoAccessState message="You do not have access to this organization setting." />
    );
  return view === 'members' ? (
    <Members organization={organization} />
  ) : view === 'invitations' ? (
    <Invitations organization={organization} />
  ) : (
    <OrganizationSettings organization={organization} />
  );
}

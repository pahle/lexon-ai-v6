'use client';

import { useMemo } from 'react';
import { useParams } from 'next/navigation';
import { useWorkspace } from '@/components/shell/workspace-provider';
import { LoadingState } from '@/components/states/page-states';
import { MatterPage } from '@/components/matters/matter-page';
import { createMattersClient } from '@/lib/matters-api';
import { createChatClient } from '@/lib/chat-client';

export default function MatterRoute() {
  const { identity } = useWorkspace();
  const { id } = useParams<{ id: string }>();
  const client = useMemo(() => createMattersClient({ baseUrl: '/api' }), []);
  const chatClient = useMemo(() => createChatClient({ baseUrl: '/api' }), []);
  if (!identity) return <LoadingState message="Verifying your workspace…" />;
  const scope = { orgId: identity.organization.id, userId: identity.user.id };
  return (
    <MatterPage
      client={client}
      scope={scope}
      projectId={id}
      chatClient={chatClient}
      orgRole={identity.organization.role}
      teamWorkspace={identity.organization.kind === 'team'}
    />
  );
}

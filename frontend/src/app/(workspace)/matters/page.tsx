'use client';

import { useMemo } from 'react';
import { useWorkspace } from '@/components/shell/workspace-provider';
import { LoadingState } from '@/components/states/page-states';
import { MattersPage } from '@/components/matters/matters-page';
import { createMattersClient } from '@/lib/matters-api';

export default function MattersRoute() {
  const { identity } = useWorkspace();
  const client = useMemo(() => createMattersClient({ baseUrl: '/api' }), []);
  if (!identity) return <LoadingState message="Verifying your workspace…" />;
  const scope = { orgId: identity.organization.id, userId: identity.user.id };
  return <MattersPage client={client} scope={scope} />;
}

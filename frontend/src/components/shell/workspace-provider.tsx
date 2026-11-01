'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { IdentitySummary } from '@lexon/contracts';
import { IdentityClientError } from '../../lib/identity-client';
import { identityApi } from '../organizations/page-state';
import { transitionTenant } from '../../lib/tenant-queries';

export type WorkspaceBootstrap =
  | { status: 'ready'; identity: IdentitySummary }
  | { status: 'mfa-required' | 'expired' | 'unavailable' };
type WorkspaceStatus = WorkspaceBootstrap['status'] | 'loading';
type WorkspaceContextValue = {
  identity: IdentitySummary | null;
  status: WorkspaceStatus;
  transitioning: boolean;
  fallbackNotice: string | null;
  refreshIdentity: () => Promise<void>;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
function accessKey(identity: IdentitySummary) {
  return `${identity.organization.id}:${identity.organization.role}:${identity.platformAdmin}`;
}

export function WorkspaceProvider({
  bootstrap,
  children,
}: {
  bootstrap: WorkspaceBootstrap;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [committedAccess, setCommittedAccess] = useState(
    bootstrap.status === 'ready' ? accessKey(bootstrap.identity) : null,
  );
  const [seenFallbacks, setSeenFallbacks] = useState<Set<string>>(
    () => new Set(),
  );
  const identityQuery = useQuery({
    queryKey: ['identity'],
    queryFn: () => identityApi.identity(),
    initialData: bootstrap.status === 'ready' ? bootstrap.identity : undefined,
    enabled: bootstrap.status === 'ready',
    refetchInterval: bootstrap.status === 'ready' ? 5000 : false,
    staleTime: 5000,
    retry: false,
  });
  const { data: identityData, error: identityError, refetch } = identityQuery;
  const identity = identityData ?? null;
  const nextAccess = identity ? accessKey(identity) : null;
  const transitioning = !!identity && nextAccess !== committedAccess;

  useEffect(() => {
    if (!identity || !transitioning) return;
    let current = true;
    void transitionTenant(queryClient, identity.organization).then(() => {
      if (current) setCommittedAccess(accessKey(identity));
    });
    return () => {
      current = false;
    };
  }, [identity, queryClient, transitioning]);

  const fallbackKey = identity?.fallbackReason
    ? `${identity.fallbackReason}:${identity.previousOrganizationName ?? ''}`
    : null;
  useEffect(() => {
    if (!fallbackKey || seenFallbacks.has(fallbackKey)) return;
    setSeenFallbacks((current) => new Set(current).add(fallbackKey));
  }, [fallbackKey, seenFallbacks]);

  const refreshIdentity = useCallback(async () => {
    await refetch();
  }, [refetch]);
  const status: WorkspaceStatus =
    identityError instanceof IdentityClientError
      ? identityError.status === 401
        ? 'expired'
        : identityError.status === 403
          ? 'mfa-required'
          : 'unavailable'
      : identityError
        ? 'unavailable'
        : identity
          ? 'ready'
          : bootstrap.status === 'mfa-required'
            ? 'mfa-required'
            : bootstrap.status === 'expired' ||
                bootstrap.status === 'unavailable'
              ? bootstrap.status
              : 'loading';
  const fallbackNotice =
    fallbackKey && seenFallbacks.has(fallbackKey)
      ? 'You no longer have access to the previous organization. Personal is selected.'
      : null;
  const value = useMemo(
    () => ({
      identity: status === 'ready' && !transitioning ? identity : null,
      status,
      transitioning,
      fallbackNotice,
      refreshIdentity,
    }),
    [identity, status, transitioning, fallbackNotice, refreshIdentity],
  );
  return (
    <WorkspaceContext.Provider value={value}>
      {children}
    </WorkspaceContext.Provider>
  );
}

export function useWorkspace() {
  const value = useContext(WorkspaceContext);
  if (!value)
    throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return value;
}

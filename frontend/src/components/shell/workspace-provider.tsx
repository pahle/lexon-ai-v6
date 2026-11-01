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
  return `${identity.user.id}:${identity.organization.id}:${identity.organization.role}:${identity.platformAdmin}`;
}
function sameIdentity(left: IdentitySummary, right: IdentitySummary) {
  return JSON.stringify(left) === JSON.stringify(right);
}
async function clearQueryFamilies(
  queryClient: ReturnType<typeof useQueryClient>,
  families: readonly (readonly unknown[])[],
) {
  await Promise.all(
    families.map((queryKey) => queryClient.cancelQueries({ queryKey })),
  );
  for (const queryKey of families) queryClient.removeQueries({ queryKey });
}
const fallbackMessage =
  'You no longer have access to the previous organization. Personal is selected.';

export function WorkspaceProvider({
  bootstrap,
  children,
}: {
  bootstrap: WorkspaceBootstrap;
  children: ReactNode;
}) {
  const queryClient = useQueryClient();
  const cachedIdentity = queryClient.getQueryData<IdentitySummary>([
    'identity',
  ]);
  const cachedIdentityState = queryClient.getQueryState(['identity']);
  const initialBootstrapSync =
    bootstrap.status === 'ready' &&
    ((cachedIdentity !== undefined &&
      !sameIdentity(cachedIdentity, bootstrap.identity)) ||
      (cachedIdentityState !== undefined &&
        (cachedIdentity === undefined || cachedIdentityState.error !== null)));
  const [bootstrapSyncPending, setBootstrapSyncPending] =
    useState(initialBootstrapSync);
  const [committedIdentity, setCommittedIdentity] =
    useState<IdentitySummary | null>(
      bootstrap.status === 'ready' ? bootstrap.identity : null,
    );
  const [freshQueryIdentity, setFreshQueryIdentity] =
    useState<IdentitySummary | null>(null);
  const [untrustedCacheClearPending, setUntrustedCacheClearPending] = useState(
    bootstrap.status !== 'ready',
  );
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(
    bootstrap.status === 'ready' && bootstrap.identity.fallbackReason
      ? fallbackMessage
      : null,
  );

  const identityQuery = useQuery({
    queryKey: ['identity'],
    queryFn: async () => {
      const verified = await identityApi.identity();
      setFreshQueryIdentity(verified);
      return verified;
    },
    initialData: bootstrap.status === 'ready' ? bootstrap.identity : undefined,
    enabled:
      (bootstrap.status === 'ready' && !bootstrapSyncPending) ||
      bootstrap.status === 'mfa-required',
    refetchInterval:
      bootstrap.status === 'ready' || bootstrap.status === 'mfa-required'
        ? 5000
        : false,
    staleTime: bootstrap.status === 'ready' ? 5000 : 0,
    retry: false,
  });
  const { data: queryIdentity, error: identityError, refetch } = identityQuery;
  const identity =
    bootstrap.status === 'ready'
      ? bootstrapSyncPending
        ? bootstrap.identity
        : (queryIdentity ?? bootstrap.identity)
      : freshQueryIdentity;
  const nextAccess = identity ? accessKey(identity) : null;
  const transitioning =
    untrustedCacheClearPending ||
    bootstrapSyncPending ||
    (!!identity &&
      nextAccess !== (committedIdentity ? accessKey(committedIdentity) : null));

  useEffect(() => {
    if (bootstrap.status !== 'ready' || !bootstrapSyncPending) return;
    let current = true;
    void (async () => {
      const old = queryClient.getQueryData<IdentitySummary>(['identity']);
      if (old && accessKey(old) !== accessKey(bootstrap.identity)) {
        await transitionTenant(queryClient, bootstrap.identity.organization);
        if (old.user.id !== bootstrap.identity.user.id) {
          await clearQueryFamilies(queryClient, [
            ['account'],
            ['platform'],
            ['organizations'],
          ]);
        } else if (old.platformAdmin && !bootstrap.identity.platformAdmin) {
          await clearQueryFamilies(queryClient, [['platform']]);
        }
        if (old.organization.id !== bootstrap.identity.organization.id) {
          await queryClient.invalidateQueries({ queryKey: ['organizations'] });
        }
      }
      if (!current) return;
      queryClient.setQueryData(['identity'], bootstrap.identity);
      setCommittedIdentity(bootstrap.identity);
      setBootstrapSyncPending(false);
    })();
    return () => {
      current = false;
    };
  }, [bootstrap, bootstrapSyncPending, queryClient]);

  useEffect(() => {
    if (!identity || bootstrapSyncPending || !transitioning) return;
    const previous = committedIdentity;
    let current = true;
    void (async () => {
      await transitionTenant(queryClient, identity.organization);
      if (previous?.user.id !== identity.user.id) {
        await clearQueryFamilies(queryClient, [
          ['account'],
          ['platform'],
          ['organizations'],
        ]);
      } else if (previous?.platformAdmin && !identity.platformAdmin) {
        await clearQueryFamilies(queryClient, [['platform']]);
      }
      if (previous?.organization.id !== identity.organization.id) {
        await queryClient.invalidateQueries({ queryKey: ['organizations'] });
      }
      if (!current) return;
      setCommittedIdentity(identity);
      if (
        identity.fallbackReason &&
        previous?.organization.id !== identity.organization.id
      ) {
        setFallbackNotice(fallbackMessage);
      } else if (!identity.fallbackReason) {
        setFallbackNotice(null);
      }
    })();
    return () => {
      current = false;
    };
  }, [
    bootstrapSyncPending,
    committedIdentity,
    identity,
    queryClient,
    transitioning,
  ]);

  useEffect(() => {
    if (!identity?.fallbackReason) setFallbackNotice(null);
  }, [identity?.fallbackReason, identity?.organization.id]);

  const status: WorkspaceStatus =
    bootstrap.status === 'expired' || bootstrap.status === 'unavailable'
      ? bootstrap.status
      : identityError
        ? identityError instanceof IdentityClientError &&
          identityError.status === 401
          ? 'expired'
          : identityError instanceof IdentityClientError &&
              identityError.code === 'AUTH_2FA_REQUIRED'
            ? 'mfa-required'
            : 'unavailable'
        : identity
          ? 'ready'
          : bootstrap.status;

  useEffect(() => {
    if (status === 'ready') return;
    void clearQueryFamilies(queryClient, [
      ['tenant'],
      ['account'],
      ['platform'],
      ['organizations'],
    ]).then(() => {
      setUntrustedCacheClearPending(false);
    });
  }, [queryClient, status]);

  const refreshIdentity = useCallback(async () => {
    await refetch();
  }, [refetch]);
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

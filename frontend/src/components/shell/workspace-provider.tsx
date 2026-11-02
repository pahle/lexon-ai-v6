'use client';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
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
  transitionNotice: { message: string; securityLink?: boolean } | null;
  beginExplicitTransition: (options?: {
    requireFreshIdentity?: boolean;
  }) => void;
  finishExplicitTransition: (notice?: {
    message: string;
    securityLink?: boolean;
  }) => void;
  refreshIdentity: () => Promise<IdentitySummary>;
};
const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);
function accessKey(identity: IdentitySummary) {
  return `${identity.user.id}:${identity.organization.id}:${identity.organization.role}:${identity.organization.require2fa}:${identity.user.twoFactorEnabled}:${identity.platformAdmin}`;
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
  const [latestVerifiedIdentity, setLatestVerifiedIdentity] =
    useState<IdentitySummary | null>(
      bootstrap.status === 'ready' ? bootstrap.identity : null,
    );
  const latestVerifiedIdentityRef = useRef(latestVerifiedIdentity);
  const identityRequestVersion = useRef(0);
  const [untrustedCacheClearPending, setUntrustedCacheClearPending] = useState(
    bootstrap.status !== 'ready',
  );
  const [fallbackNotice, setFallbackNotice] = useState<string | null>(
    bootstrap.status === 'ready' && bootstrap.identity.fallbackReason
      ? fallbackMessage
      : null,
  );
  const [explicitTransitionPending, setExplicitTransitionPending] =
    useState(false);
  const [mustVerifyIdentity, setMustVerifyIdentity] = useState(false);
  const [refreshFailure, setRefreshFailure] = useState<unknown>(null);
  const [transitionNotice, setTransitionNotice] = useState<{
    message: string;
    securityLink?: boolean;
  } | null>(null);

  const publishVerifiedIdentity = useCallback((verified: IdentitySummary) => {
    latestVerifiedIdentityRef.current = verified;
    setLatestVerifiedIdentity(verified);
    setMustVerifyIdentity(false);
    setRefreshFailure(null);
    setBootstrapSyncPending(false);
  }, []);

  const requestIdentity = useCallback(async () => {
    const requestVersion = ++identityRequestVersion.current;
    try {
      const verified = await identityApi.identity();
      if (requestVersion !== identityRequestVersion.current) {
        const latest = latestVerifiedIdentityRef.current;
        if (latest) return latest;
        throw new Error('Identity request was superseded before verification.');
      }
      publishVerifiedIdentity(verified);
      return verified;
    } catch (error) {
      if (requestVersion !== identityRequestVersion.current) {
        const latest = latestVerifiedIdentityRef.current;
        if (latest) return latest;
      }
      throw error;
    }
  }, [publishVerifiedIdentity]);

  const identityPollingEnabled =
    !mustVerifyIdentity &&
    ((bootstrap.status === 'ready' && !bootstrapSyncPending) ||
      bootstrap.status === 'mfa-required' ||
      !!latestVerifiedIdentity);
  const identityQuery = useQuery({
    queryKey: ['identity'],
    queryFn: requestIdentity,
    initialData:
      bootstrap.status === 'ready'
        ? (latestVerifiedIdentity ?? bootstrap.identity)
        : undefined,
    enabled: identityPollingEnabled,
    refetchInterval: identityPollingEnabled ? 5000 : false,
    staleTime:
      bootstrap.status === 'ready' || latestVerifiedIdentity ? 5000 : 0,
    retry: false,
  });
  const { data: queryIdentity, error: identityError } = identityQuery;
  const identity = mustVerifyIdentity
    ? null
    : bootstrapSyncPending
      ? bootstrap.status === 'ready'
        ? bootstrap.identity
        : null
      : bootstrap.status === 'ready'
        ? (queryIdentity ?? latestVerifiedIdentity)
        : latestVerifiedIdentity;
  const nextAccess = identity ? accessKey(identity) : null;
  const accessTransitioning =
    untrustedCacheClearPending ||
    bootstrapSyncPending ||
    (!!identity &&
      nextAccess !== (committedIdentity ? accessKey(committedIdentity) : null));
  const transitioning = accessTransitioning || explicitTransitionPending;

  useEffect(() => {
    if (bootstrap.status !== 'ready' || !bootstrapSyncPending) return;
    const syncVersion = ++identityRequestVersion.current;
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
      if (!current || syncVersion !== identityRequestVersion.current) return;
      queryClient.setQueryData(['identity'], bootstrap.identity);
      publishVerifiedIdentity(bootstrap.identity);
      setCommittedIdentity(bootstrap.identity);
    })();
    return () => {
      current = false;
    };
  }, [bootstrap, bootstrapSyncPending, publishVerifiedIdentity, queryClient]);

  useEffect(() => {
    if (!identity || bootstrapSyncPending || !accessTransitioning) return;
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
    accessTransitioning,
    committedIdentity,
    identity,
    queryClient,
  ]);

  useEffect(() => {
    if (!identity?.fallbackReason) setFallbackNotice(null);
  }, [identity?.fallbackReason, identity?.organization.id]);

  const effectiveIdentityError = identityError ?? refreshFailure;
  const status: WorkspaceStatus =
    bootstrap.status === 'expired'
      ? 'expired'
      : effectiveIdentityError
        ? effectiveIdentityError instanceof IdentityClientError &&
          effectiveIdentityError.status === 401
          ? 'expired'
          : effectiveIdentityError instanceof IdentityClientError &&
              effectiveIdentityError.code === 'AUTH_2FA_REQUIRED'
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
    const requestVersion = ++identityRequestVersion.current;
    try {
      await queryClient.cancelQueries({ queryKey: ['identity'] });
      const verified = await identityApi.identity();
      if (requestVersion !== identityRequestVersion.current) {
        const latest = latestVerifiedIdentityRef.current;
        if (latest) return latest;
        throw new Error('Identity request was superseded before verification.');
      }
      publishVerifiedIdentity(verified);
      queryClient.setQueryData(['identity'], verified);
      return verified;
    } catch (error) {
      if (requestVersion === identityRequestVersion.current)
        setRefreshFailure(error);
      throw error;
    }
  }, [publishVerifiedIdentity, queryClient]);
  const beginExplicitTransition = useCallback(
    (options?: { requireFreshIdentity?: boolean }) => {
      setTransitionNotice(null);
      setExplicitTransitionPending(true);
      if (options?.requireFreshIdentity) {
        identityRequestVersion.current += 1;
        latestVerifiedIdentityRef.current = null;
        setMustVerifyIdentity(true);
        setLatestVerifiedIdentity(null);
        void queryClient.cancelQueries({ queryKey: ['identity'] });
      }
    },
    [queryClient],
  );
  const finishExplicitTransition = useCallback(
    (notice?: { message: string; securityLink?: boolean }) => {
      setTransitionNotice(notice ?? null);
      setExplicitTransitionPending(false);
    },
    [],
  );
  const value = useMemo(
    () => ({
      identity: status === 'ready' && !transitioning ? identity : null,
      status,
      transitioning,
      fallbackNotice,
      transitionNotice,
      beginExplicitTransition,
      finishExplicitTransition,
      refreshIdentity,
    }),
    [
      identity,
      status,
      transitioning,
      fallbackNotice,
      transitionNotice,
      beginExplicitTransition,
      finishExplicitTransition,
      refreshIdentity,
    ],
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

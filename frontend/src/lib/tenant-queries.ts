import type { QueryClient } from '@tanstack/react-query';
import type { OrganizationSummary } from '@lexon/contracts';
export async function transitionTenant(
  client: QueryClient,
  next: OrganizationSummary,
): Promise<void> {
  await client.cancelQueries({ queryKey: ['tenant'] });
  client.removeQueries({ queryKey: ['tenant'] });
  client.setQueryData(['active-organization'], next);
}

export function isTenantScopeCurrent(
  client: QueryClient,
  scope: { readonly orgId: string; readonly userId: string },
): boolean {
  const identity = client.getQueryData<{
    readonly user?: { readonly id?: string };
    readonly organization?: { readonly id?: string };
  }>(['identity']);
  const activeOrganization = client.getQueryData<{ readonly id?: string }>([
    'active-organization',
  ]);
  return (
    identity?.user?.id === scope.userId &&
    identity.organization?.id === scope.orgId &&
    (!activeOrganization || activeOrganization.id === scope.orgId)
  );
}

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

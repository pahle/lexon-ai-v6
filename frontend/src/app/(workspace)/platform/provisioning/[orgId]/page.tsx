import { redirect } from 'next/navigation';

/** Retired route: a provisioning organization opens its organization record. */
export default async function ProvisioningDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}): Promise<never> {
  const { orgId } = await params;
  redirect(`/platform/organizations/${encodeURIComponent(orgId)}`);
}

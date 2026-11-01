import { OrganizationPage } from '../../../../../components/organizations/organization-page';
export default async function Page({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <OrganizationPage organizationId={(await params).orgId} view="members" />
    </main>
  );
}

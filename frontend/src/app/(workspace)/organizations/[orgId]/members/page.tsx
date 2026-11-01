import { OrganizationPage } from '../../../../../components/organizations/organization-page';
export default async function Page({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <OrganizationPage organizationId={(await params).orgId} view="members" />
    </div>
  );
}

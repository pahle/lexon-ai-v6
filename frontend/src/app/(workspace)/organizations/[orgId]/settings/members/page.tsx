import { OrganizationPage } from '../../../../../../components/organizations/organization-page';
import { OrganizationSettingsPageFrame } from '../../../../../../components/settings/organization-settings-page-frame';

export default async function MembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <OrganizationSettingsPageFrame>
      <OrganizationPage organizationId={orgId} view="members" />
    </OrganizationSettingsPageFrame>
  );
}

export const metadata = {
  title: 'Organization members | Lexon',
  description: 'Manage team members and roles.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

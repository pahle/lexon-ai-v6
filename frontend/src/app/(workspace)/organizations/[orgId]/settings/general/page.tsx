import { OrganizationPage } from '../../../../../../components/organizations/organization-page';
import { OrganizationSettingsPageFrame } from '../../../../../../components/settings/organization-settings-page-frame';

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <OrganizationSettingsPageFrame>
      <OrganizationPage organizationId={orgId} view="general" />
    </OrganizationSettingsPageFrame>
  );
}

export const metadata = {
  title: 'Organization general settings | Lexon',
  description: 'Manage the team name, slug, and authentication requirements.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

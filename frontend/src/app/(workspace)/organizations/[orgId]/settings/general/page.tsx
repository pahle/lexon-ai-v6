import { OrganizationPage } from '../../../../../../components/organizations/organization-page';
import { SettingsPageFrame } from '../../../../../../components/settings/settings-page-frame';

export default async function GeneralSettingsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const items = [
    {
      href: `/organizations/${orgId}/settings/members`,
      label: 'Members',
      current: false,
    },
    {
      href: `/organizations/${orgId}/settings/invitations`,
      label: 'Invitations',
      current: false,
    },
    {
      href: `/organizations/${orgId}/settings/general`,
      label: 'General',
      current: true,
    },
  ] as const;
  return (
    <SettingsPageFrame title="Organization settings" items={items}>
      <OrganizationPage organizationId={orgId} view="general" />
    </SettingsPageFrame>
  );
}

export const metadata = {
  title: 'Organization general settings | Lexon',
  description: 'Manage the team name, slug, and authentication requirements.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

import { OrganizationPage } from '../../../../../../components/organizations/organization-page';
import { SettingsPageFrame } from '../../../../../../components/settings/settings-page-frame';

export default async function MembersPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  const items = [
    {
      href: `/organizations/${orgId}/settings/members`,
      label: 'Members',
      current: true,
    },
    {
      href: `/organizations/${orgId}/settings/invitations`,
      label: 'Invitations',
      current: false,
    },
    {
      href: `/organizations/${orgId}/settings/general`,
      label: 'General',
      current: false,
    },
  ] as const;
  return (
    <SettingsPageFrame title="Organization settings" items={items}>
      <OrganizationPage organizationId={orgId} view="members" />
    </SettingsPageFrame>
  );
}

export const metadata = {
  title: 'Organization members | Lexon',
  description: 'Manage team members and roles.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

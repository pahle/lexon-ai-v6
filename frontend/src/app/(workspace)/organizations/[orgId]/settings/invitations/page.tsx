import { OrganizationPage } from '../../../../../../components/organizations/organization-page';
import { SettingsPageFrame } from '../../../../../../components/settings/settings-page-frame';

export default async function InvitationsPage({
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
      current: true,
    },
    {
      href: `/organizations/${orgId}/settings/general`,
      label: 'General',
      current: false,
    },
  ] as const;
  return (
    <SettingsPageFrame title="Organization settings" items={items}>
      <OrganizationPage organizationId={orgId} view="invitations" />
    </SettingsPageFrame>
  );
}

export const metadata = {
  title: 'Organization invitations | Lexon',
  description: 'Invite people and manage pending team invitations.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

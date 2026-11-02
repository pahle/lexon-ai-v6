import { OrganizationPage } from '../../../../../../components/organizations/organization-page';
import { OrganizationSettingsPageFrame } from '../../../../../../components/settings/organization-settings-page-frame';

export default async function InvitationsPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  const { orgId } = await params;
  return (
    <OrganizationSettingsPageFrame organizationId={orgId} current="invitations">
      <OrganizationPage organizationId={orgId} view="invitations" />
    </OrganizationSettingsPageFrame>
  );
}

export const metadata = {
  title: 'Organization invitations | Lexon',
  description: 'Invite people and manage pending team invitations.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

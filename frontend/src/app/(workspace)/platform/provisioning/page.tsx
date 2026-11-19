import { ProvisioningList } from '../../../../components/platform/provisioning';
import { PlatformPage } from '../../../../components/platform/platform-page';
export default function ProvisioningPage() {
  return (
    <PlatformPage
      title="Organization provisioning"
      description="Create team organizations and track their first owner invitations."
    >
      <ProvisioningList />
    </PlatformPage>
  );
}
export const metadata = {
  title: 'Organization provisioning | Lexon',
  description: 'Review organizations waiting for platform provisioning.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

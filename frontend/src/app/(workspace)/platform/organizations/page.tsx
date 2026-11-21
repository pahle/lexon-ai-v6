import { OrganizationsPage } from '../../../../components/platform-console/organizations-page';
import { PlatformPage } from '../../../../components/platform/platform-page';

export default function PlatformOrganizationsPage() {
  return (
    <PlatformPage>
      <OrganizationsPage />
    </PlatformPage>
  );
}
export const metadata = {
  title: 'Organizations | Lexon',
  description: 'Review team organizations and provision new ones.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

import { ProvisioningDetail } from '../../../../../components/platform/provisioning-detail';
import { PlatformPage } from '../../../../../components/platform/platform-page';
export default async function ProvisioningDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <PlatformPage title="Organization provisioning details">
      <ProvisioningDetail organizationId={(await params).orgId} />
    </PlatformPage>
  );
}
export const metadata = {
  title: 'Organization provisioning details | Lexon',
  description: 'Review and complete organization provisioning.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

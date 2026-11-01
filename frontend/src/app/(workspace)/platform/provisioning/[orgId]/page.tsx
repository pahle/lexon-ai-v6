import { ProvisioningDetail } from '../../../../../components/platform/provisioning-detail';
export default async function ProvisioningDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <div className="mx-auto max-w-2xl">
      <ProvisioningDetail organizationId={(await params).orgId} />
    </div>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

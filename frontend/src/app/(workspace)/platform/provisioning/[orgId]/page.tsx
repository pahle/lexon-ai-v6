import { ProvisioningDetail } from '../../../../../components/platform/provisioning-detail';
export default async function ProvisioningDetailPage({
  params,
}: {
  params: Promise<{ orgId: string }>;
}) {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <ProvisioningDetail organizationId={(await params).orgId} />
    </main>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

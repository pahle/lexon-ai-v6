import { ProvisioningList } from '../../../../components/platform/provisioning';
export default function ProvisioningPage() {
  return (
    <main className="mx-auto max-w-2xl p-6">
      <ProvisioningList />
    </main>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

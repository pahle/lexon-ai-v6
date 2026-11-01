import { ProvisioningList } from '../../../../components/platform/provisioning';
export default function ProvisioningPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <ProvisioningList />
    </div>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

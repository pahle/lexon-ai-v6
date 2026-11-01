import { AccountStatusForm } from '../../../../components/platform/account-status-form';
export default function AccountStatusPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <AccountStatusForm />
    </div>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

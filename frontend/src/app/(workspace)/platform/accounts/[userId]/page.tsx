import { AccountRecord } from '../../../../../components/platform-console/account-record';
import { PlatformPage } from '../../../../../components/platform/platform-page';

export default async function AccountRecordPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return (
    <PlatformPage>
      <AccountRecord userId={userId} />
    </PlatformPage>
  );
}
export const metadata = {
  title: 'Account | Lexon',
  description: 'Review an account and manage its access.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

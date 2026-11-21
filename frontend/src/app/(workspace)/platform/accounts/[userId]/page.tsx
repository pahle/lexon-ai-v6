import { AccountRecord } from '../../../../../components/platform-console/account-record';

export default async function AccountRecordPage({
  params,
}: {
  params: Promise<{ userId: string }>;
}) {
  const { userId } = await params;
  return <AccountRecord userId={userId} />;
}
export const metadata = {
  title: 'Account | Lexon',
  description: 'Review an account and manage its access.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

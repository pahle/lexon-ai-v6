import { TwoFactorChallenge } from '../../../components/auth/two-factor-challenge';
export default async function TwoFactorPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string }>;
}) {
  return <TwoFactorChallenge returnTo={(await searchParams).returnTo} />;
}
export const metadata = {
  title: 'Verify sign-in | Lexon',
  description: 'Verify your identity with an authentication code.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

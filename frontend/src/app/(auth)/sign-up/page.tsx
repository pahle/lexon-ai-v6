import { SignupForm } from '../../../components/auth/signup-form';
export default async function SignupPage({
  searchParams,
}: {
  searchParams: Promise<{
    invitationId?: string | undefined;
    setupToken?: string | undefined;
    returnTo?: string | undefined;
  }>;
}) {
  const query = await searchParams;
  return (
    <SignupForm
      invitationId={query.invitationId}
      setupToken={query.setupToken}
      returnTo={query.returnTo}
    />
  );
}
export const metadata = {
  title: 'Create an account | Lexon',
  description: 'Create your Lexon account.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

import { LoginForm } from '../../../components/auth/login-form';
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | undefined }>;
}) {
  const query = await searchParams;
  return (
    <LoginForm
      returnTo={query.returnTo}
      visualClientReady={process.env.LEXON_VISUAL_DEV === '1'}
    />
  );
}
export const metadata = {
  title: 'Sign in | Lexon',
  description: 'Sign in to your Lexon workspace.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

import { LoginForm } from '../../../components/auth/login-form';
export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{ returnTo?: string | undefined }>;
}) {
  const query = await searchParams;
  return <LoginForm returnTo={query.returnTo} />;
}

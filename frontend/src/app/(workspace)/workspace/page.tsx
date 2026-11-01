import { redirect } from 'next/navigation';
import { loadIdentityPage } from '../../../lib/identity-page';
import { Workspace } from '../../../components/organizations/workspace';
export default async function WorkspacePage() {
  const result = await loadIdentityPage();
  if (!result.identity) return result.view;
  if (!result.identity.user.onboardingCompleted) redirect('/onboarding');
  return (
    <main className="mx-auto max-w-2xl p-6">
      <Workspace initial={result.identity} />
    </main>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

import { redirect } from 'next/navigation';
import { loadIdentityPage } from '../../../lib/identity-page';
import { Onboarding } from '../../../components/organizations/onboarding';
export default async function OnboardingPage() {
  const result = await loadIdentityPage();
  if (!result.identity) return result.view;
  if (result.identity.user.onboardingCompleted) redirect('/workspace');
  const invitations = await result.api.listMyInvitations({ limit: 100 });
  return (
    <main className="flex min-h-svh items-center justify-center p-6">
      <Onboarding
        profile={result.identity.user}
        invitations={invitations.items}
      />
    </main>
  );
}
export const metadata = {
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

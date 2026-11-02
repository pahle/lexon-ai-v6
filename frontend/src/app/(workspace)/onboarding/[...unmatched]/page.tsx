import { notFound } from 'next/navigation';

export default function UnmatchedOnboardingPage(): never {
  notFound();
}

export const metadata = {
  title: 'Onboarding page not found | Lexon',
  description: 'The requested onboarding page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

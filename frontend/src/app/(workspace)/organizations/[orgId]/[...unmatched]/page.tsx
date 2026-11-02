import { notFound } from 'next/navigation';

export default function UnmatchedOrganizationPage(): never {
  notFound();
}

export const metadata = {
  title: 'Organization page not found | Lexon',
  description: 'The requested organization page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

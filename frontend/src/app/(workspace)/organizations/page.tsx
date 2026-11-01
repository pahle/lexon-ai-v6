import { notFound } from 'next/navigation';

export default function OrganizationsPage(): never {
  notFound();
}

export const metadata = {
  title: 'Organizations | Lexon',
  description: 'Organization workspace not found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

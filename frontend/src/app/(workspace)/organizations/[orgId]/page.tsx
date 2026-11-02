import { notFound } from 'next/navigation';

export default function OrganizationIndexPage(): never {
  notFound();
}

export const metadata = {
  title: 'Organization | Lexon',
  description: 'Organization workspace not found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

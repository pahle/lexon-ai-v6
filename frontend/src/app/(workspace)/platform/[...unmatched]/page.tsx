import { notFound } from 'next/navigation';

export default function UnmatchedPlatformPage(): never {
  notFound();
}

export const metadata = {
  title: 'Platform page not found | Lexon',
  description: 'The requested platform page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

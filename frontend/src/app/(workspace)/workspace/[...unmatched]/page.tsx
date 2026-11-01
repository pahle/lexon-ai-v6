import { notFound } from 'next/navigation';

export default function UnmatchedWorkspacePage(): never {
  notFound();
}

export const metadata = {
  title: 'Workspace page not found | Lexon',
  description: 'The requested workspace page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

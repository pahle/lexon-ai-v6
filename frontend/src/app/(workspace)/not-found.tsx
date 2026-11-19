import { WorkspaceNotFound } from '@/components/states/workspace-not-found';

export default function NotFound() {
  return <WorkspaceNotFound />;
}

export const metadata = {
  title: 'Workspace page not found | Lexon',
  description: 'The requested workspace page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

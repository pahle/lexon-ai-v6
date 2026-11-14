import { WorkspaceNotFound } from '@/components/states/workspace-not-found';

export default function UnmatchedChatPath() {
  return <WorkspaceNotFound />;
}

export const metadata = {
  title: 'Page not found | Lexon',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

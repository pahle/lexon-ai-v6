import { CompassIcon } from 'lucide-react';
import { StandaloneStatusPage } from '@/components/states/status-page';

export default function NotFound() {
  return (
    <StandaloneStatusPage
      icon={<CompassIcon />}
      title="Page not found"
      text="The page you are looking for does not exist or has moved."
      action={{ label: 'Go to Lexon', href: '/workspace' }}
    />
  );
}

export const metadata = {
  title: 'Page not found | Lexon',
  description: 'The requested page could not be found.',
  robots: { index: false, follow: false },
  referrer: 'no-referrer',
};

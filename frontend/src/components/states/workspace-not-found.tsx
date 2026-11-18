import { CompassIcon } from 'lucide-react';
import { StatusPage } from './status-page';

export function WorkspaceNotFound() {
  return (
    <StatusPage
      icon={<CompassIcon />}
      title="Page not found"
      text="The page you are looking for does not exist or has moved."
      action={{ label: 'Return to workspace', href: '/workspace' }}
    />
  );
}

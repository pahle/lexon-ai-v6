'use client';

import { AlertCircleIcon } from 'lucide-react';
import { StatusPage } from '../../components/states/status-page';

export default function WorkspaceError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <StatusPage
      role="alert"
      icon={<AlertCircleIcon />}
      title="Something went wrong"
      text="We could not load this page. Your work is saved."
      action={{ label: 'Try again', onClick: retry }}
      secondaryLink={{ label: 'Return to workspace', href: '/workspace' }}
    />
  );
}

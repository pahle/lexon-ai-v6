'use client';

import { AlertCircleIcon } from 'lucide-react';
import { StandaloneStatusPage } from '../components/states/status-page';

export default function RootError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <StandaloneStatusPage
      role="alert"
      icon={<AlertCircleIcon />}
      title="Something went wrong"
      text="We could not load this page. Your work is saved."
      action={{ label: 'Try again', onClick: retry }}
      secondaryLink={{ label: 'Go to my workspace', href: '/workspace' }}
    />
  );
}

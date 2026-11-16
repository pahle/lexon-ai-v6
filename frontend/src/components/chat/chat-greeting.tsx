'use client';

import { useEffect, useState, type FC } from 'react';
import { cn } from '@/lib/utils';
import { firstName, greetingFor } from '@/lib/greeting';

/**
 * Time-of-day greeting for the new chat page. The text depends on the
 * browser's local time, so it is set after mount: the server render and the
 * hydration pass both produce an empty heading that reserves its height.
 */
export const ChatGreeting: FC<{ displayName: string; className?: string }> = ({
  displayName,
  className,
}) => {
  const [greeting, setGreeting] = useState('');
  useEffect(() => {
    const name = firstName(displayName);
    const salutation = greetingFor(new Date().getHours());
    setGreeting(name ? `${salutation}, ${name}` : salutation);
  }, [displayName]);
  return (
    <h2
      className={cn(
        'min-h-9 font-serif text-2xl font-medium tracking-tight',
        className,
      )}
    >
      {greeting}
    </h2>
  );
};

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
        'min-h-[52px] text-center font-serif text-[46px] leading-[normal] font-normal tracking-[-.01em] max-md:min-h-[37px] max-md:px-4 max-md:text-[32px]',
        className,
      )}
    >
      {greeting}
    </h2>
  );
};

'use client';

import { composerClasses } from '@/components/chat/composer-styles';
import { cn } from '@/lib/utils';
import type { FC } from 'react';

export type ComposerReasonKind = 'loading' | 'running-blocked' | null;

/** The accessible name of Send, with the reason when it cannot send. */
export function sendLabel(unavailable: 'loading' | 'running' | null): string {
  if (unavailable === 'loading')
    return 'Send (unavailable: the chat is loading)';
  if (unavailable === 'running')
    return 'Send (unavailable: an answer is still arriving)';
  return 'Send message';
}

/**
 * The line under the composer box (LEX-DS-001 v3.2 §5.5 Composer): the
 * disclaimer, or the reason the composer cannot send. A polite status so the
 * change is announced.
 */
export const ComposerReason: FC<{ reason: ComposerReasonKind }> = ({
  reason,
}) => (
  <p
    role="status"
    className={cn(
      composerClasses.disclaimer,
      reason === 'running-blocked' && 'text-foreground',
    )}
  >
    {reason === 'loading'
      ? 'Loading this chat…'
      : reason === 'running-blocked'
        ? 'Wait for the answer to finish, or stop it.'
        : 'Lexon can make mistakes. Verify important legal information.'}
  </p>
);

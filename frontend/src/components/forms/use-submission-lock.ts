'use client';

import { useCallback, useRef, useState } from 'react';

export function useSubmissionLock() {
  const locked = useRef(false);
  const [pending, setPending] = useState(false);

  const run = useCallback(async (action: () => Promise<void>) => {
    if (locked.current) return;
    locked.current = true;
    setPending(true);
    try {
      await action();
    } finally {
      locked.current = false;
      setPending(false);
    }
  }, []);

  return { pending, run };
}

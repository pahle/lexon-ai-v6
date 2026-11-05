'use client';

import { useEffect } from 'react';

export function useVisualAuthFormReady(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    document.documentElement.dataset.lexonVisualAuthReady = 'true';
    return () => {
      delete document.documentElement.dataset.lexonVisualAuthReady;
    };
  }, [enabled]);
}

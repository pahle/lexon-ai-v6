import * as React from 'react';

const MOBILE_BREAKPOINT = 768;

export function useIsMobile() {
  const [isMobile, setIsMobile] = React.useState<boolean | undefined>(
    undefined,
  );

  React.useEffect(() => {
    const onChange = () => {
      setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    };
    const mql =
      typeof window.matchMedia === 'function'
        ? window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`)
        : null;
    mql?.addEventListener('change', onChange);
    window.addEventListener('resize', onChange);
    setIsMobile(window.innerWidth < MOBILE_BREAKPOINT);
    return () => {
      mql?.removeEventListener('change', onChange);
      window.removeEventListener('resize', onChange);
    };
  }, []);

  return !!isMobile;
}

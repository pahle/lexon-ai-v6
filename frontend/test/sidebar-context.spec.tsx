import { createElement } from 'react';
import { expect, test, vi } from 'vitest';
import { render, settle } from './render';
import {
  CompositeSidebarProvider,
  useOptionalSidebar,
} from '../src/components/shell/sidebar-context';

function SidebarStateProbe() {
  const state = useOptionalSidebar();
  return createElement(
    'output',
    null,
    state ? `${state.state}:${state.isMobile}` : 'outside-provider',
  );
}

test('optional sidebar state is absent outside and bridged through the published provider', async () => {
  const standalone = await render(createElement(SidebarStateProbe));
  expect(standalone.container.textContent).toBe('outside-provider');
  await standalone.unmount();

  vi.stubGlobal('matchMedia', () => ({
    addEventListener: () => {},
    removeEventListener: () => {},
    matches: true,
  }));
  window.innerWidth = 390;
  const wrapped = await render(
    createElement(
      CompositeSidebarProvider,
      { defaultOpen: false },
      createElement(SidebarStateProbe),
    ),
  );
  await settle();
  expect(wrapped.container.textContent).toBe('collapsed:true');
  await wrapped.unmount();
  vi.unstubAllGlobals();
});

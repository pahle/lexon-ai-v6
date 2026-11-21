import { act, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
export async function render(node: ReactNode) {
  const container = document.createElement('div');
  document.body.append(container);
  const root = createRoot(container);
  await act(async () => root.render(node));
  return {
    container,
    async rerender(next: ReactNode) {
      await act(async () => root.render(next));
    },
    async unmount() {
      await act(async () => root.unmount());
      container.remove();
    },
  };
}
export async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
/**
 * Settles until a condition holds instead of sleeping a fixed interval, for
 * UI that waits on a chain of requests (the fixed 10 ms of settle() is not
 * enough when the runner is loaded). Bounded by the test timeout, not by a
 * counter.
 */
export async function settleUntil(done: () => boolean) {
  await settle();
  while (!done()) await settle();
}
export async function submit(container: HTMLElement, value: string) {
  const input = container.querySelector('input')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      'value',
    )!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
    container
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });
  await settle();
}

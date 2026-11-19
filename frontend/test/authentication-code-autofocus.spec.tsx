import { beforeAll, expect, test } from 'vitest';
import { render, settle } from './render';
import { AuthenticationCodeForm } from '../src/components/auth/authentication-code-form';

// input-otp probes document.elementFromPoint from a timer after focus; jsdom
// has none, so the timer threw after the test ended (CI unhandled error).
beforeAll(() => {
  if (typeof document.elementFromPoint !== 'function')
    document.elementFromPoint = () => null;
});

test('the authentication code input is focused on mount', async () => {
  const view = await render(
    <AuthenticationCodeForm presentation="auth" onSubmit={async () => {}} />,
  );
  await settle();
  const input = view.container.querySelector('input')!;
  expect(document.activeElement).toBe(input);
  await view.unmount();
});

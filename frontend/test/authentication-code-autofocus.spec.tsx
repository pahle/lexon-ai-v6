import { expect, test } from 'vitest';
import { render, settle } from './render';
import { AuthenticationCodeForm } from '../src/components/auth/authentication-code-form';

test('the authentication code input is focused on mount', async () => {
  const view = await render(
    <AuthenticationCodeForm presentation="auth" onSubmit={async () => {}} />,
  );
  await settle();
  const input = view.container.querySelector('input')!;
  expect(document.activeElement).toBe(input);
  await view.unmount();
});

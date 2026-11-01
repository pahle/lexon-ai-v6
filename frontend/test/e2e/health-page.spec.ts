import { test, expect } from '@playwright/test';
test('frontend public liveness does not depend on identity redirects', async ({
  request,
}) => {
  const descriptor = JSON.parse(process.env.LEXON_E2E_DESCRIPTOR ?? '{}') as {
    frontendUrl: string;
  };
  const response = await request.get(descriptor.frontendUrl + '/health');
  expect(response.status()).toBe(200);
  expect(await response.json()).toEqual({ status: 'ok' });
});

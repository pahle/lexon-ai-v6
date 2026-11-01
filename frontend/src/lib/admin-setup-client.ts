import { FlowTokenSchema } from '@lexon/contracts';
export async function setupCommand(
  action: 'redeem' | 'complete',
  token: string,
): Promise<void> {
  let response: Response;
  try {
    response = await fetch('/api/identity/admin-setup/' + action, {
      method: 'POST',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ token: FlowTokenSchema.parse(token) }),
    });
  } catch {
    throw new Error('Setup unavailable');
  }
  if (!response.ok) throw new Error('Setup unavailable');
}

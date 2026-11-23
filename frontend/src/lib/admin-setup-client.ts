import { FlowTokenSchema } from '@lexon/contracts';
import { requestJson } from './request-json';
export async function setupCommand(
  action: 'redeem' | 'complete',
  token: string,
): Promise<void> {
  const unavailable = () => new Error('Setup unavailable');
  const parsed = FlowTokenSchema.safeParse(token);
  if (!parsed.success) throw unavailable();
  const response = await requestJson(
    '/api/identity/admin-setup/' + action,
    { method: 'POST', body: { token: parsed.data } },
    unavailable,
  );
  if (!response.ok) throw unavailable();
}

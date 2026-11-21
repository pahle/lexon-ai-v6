import type { z } from 'zod';
import {
  AccountInvitationInputSchema,
  AccountInvitationSchema,
  AccountInvitationsPageSchema,
  IdentityErrorResponseSchema,
  PlatformAccountsPageSchema,
  type AccountInvitation,
} from '@lexon/contracts';
import { IdentityClientError } from '../../lib/identity-client';

type Issue = { path: string; message: string };

/** An identity client error that also carries the server's field issues. */
export class PlatformApiError extends IdentityClientError {
  constructor(
    code: string,
    status: number,
    readonly issues: Issue[] = [],
  ) {
    super(code, status);
  }
}

async function call<T>(
  path: string,
  schema: z.ZodType<T>,
  init?: { method: string; body: unknown },
): Promise<T> {
  let response: Response;
  try {
    response = await fetch('/api' + path, {
      method: init?.method ?? 'GET',
      credentials: 'same-origin',
      cache: 'no-store',
      signal: AbortSignal.timeout(10000),
      ...(init
        ? {
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(init.body),
          }
        : {}),
    });
  } catch {
    throw new PlatformApiError('AUTH_UNAVAILABLE', 503);
  }
  if (!response.ok) {
    let code = 'AUTH_UNAVAILABLE';
    let issues: Issue[] = [];
    try {
      const parsed = IdentityErrorResponseSchema.safeParse(
        await response.json(),
      );
      if (parsed.success) {
        code = parsed.data.error.code;
        issues = parsed.data.error.issues ?? [];
      } else if (response.status === 401) code = 'AUTH_REQUIRED';
    } catch {
      /* Fixed safe fallback for malformed error bodies. */
    }
    throw new PlatformApiError(code, response.status, issues);
  }
  try {
    return schema.parse(await response.json());
  } catch {
    throw new PlatformApiError('AUTH_UNAVAILABLE', 503);
  }
}

function search(params: Record<string, string | string[] | number>) {
  const out = new URLSearchParams();
  for (const [key, value] of Object.entries(params))
    for (const v of [value].flat())
      if (v !== '' && !(Array.isArray(value) && !value.length))
        out.append(key, String(v));
  return out.size ? `?${out}` : '';
}

export type ListParams = Record<string, string | string[] | number>;

export const platformConsoleApi = {
  listAccounts: (params: ListParams) =>
    call('/platform/accounts' + search(params), PlatformAccountsPageSchema),
  listInvitations: (params: ListParams) =>
    call(
      '/platform/account-invitations' + search(params),
      AccountInvitationsPageSchema,
    ),
  invite: (input: unknown): Promise<AccountInvitation> =>
    call('/platform/account-invitations', AccountInvitationSchema, {
      method: 'POST',
      body: AccountInvitationInputSchema.parse(input),
    }),
};

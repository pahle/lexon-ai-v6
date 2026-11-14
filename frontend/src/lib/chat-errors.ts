import {
  ErrorResponseSchema,
  SafeErrorCodeSchema,
  SafeErrorMessages,
  type SafeErrorCode,
} from '@lexon/contracts';

const fallbackCode = 'AI_INTERNAL' satisfies SafeErrorCode;

export class ChatClientError extends Error {
  constructor(
    readonly code: SafeErrorCode,
    readonly status: number,
  ) {
    super(SafeErrorMessages[code]);
    this.name = 'ChatClientError';
  }
}

export async function chatClientError(
  response: Response,
): Promise<ChatClientError> {
  try {
    const parsed = ErrorResponseSchema.safeParse(await response.json());
    if (parsed.success) {
      const code = SafeErrorCodeSchema.safeParse(parsed.data.error.code);
      if (code.success) return new ChatClientError(code.data, response.status);
    }
  } catch {
    // Use the fixed safe message below for malformed error responses.
  }
  return new ChatClientError(
    response.status === 401 ? 'AI_ACCESS_REVOKED' : fallbackCode,
    response.status,
  );
}

export function safeChatError(code: string | null | undefined): string {
  const parsed = SafeErrorCodeSchema.safeParse(code);
  return parsed.success
    ? SafeErrorMessages[parsed.data]
    : SafeErrorMessages.AI_INTERNAL;
}

export function orderExactCaptureRows<
  T extends { items: Array<{ email: string }>; [key: string]: unknown },
>(body: T, orderedEmails: readonly string[], contentLabel?: string): T;

/**
 * Shared run-routing check: a resolved config may steer its outbox jobs onto
 * a named queue with a safe-integer priority 1–10. Anything else (missing
 * fields, a non-integer or out-of-range priority) falls back to the default
 * routing instead of poisoning the outbox append — the repository validates
 * the same range and throws, which is what made a lax check here retry an
 * expiry candidate forever.
 */
export function isRouting(
  value: unknown,
): value is { queue: 'ai-interactive' | 'ai-batch'; priority: number } {
  if (!value || typeof value !== 'object') return false;
  const config = value as Record<string, unknown>;
  return (
    (config.queue === 'ai-interactive' || config.queue === 'ai-batch') &&
    Number.isSafeInteger(config.priority) &&
    Number(config.priority) >= 1 &&
    Number(config.priority) <= 10
  );
}

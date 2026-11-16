export type Greeting = 'Good morning' | 'Good afternoon' | 'Good evening';

/** Morning is 05:00–11:59, afternoon 12:00–17:59, otherwise evening. */
export function greetingFor(hour: number): Greeting {
  if (hour >= 5 && hour < 12) return 'Good morning';
  if (hour >= 12 && hour < 18) return 'Good afternoon';
  return 'Good evening';
}

/** First whitespace-separated word of a display name; "" when empty. */
export function firstName(displayName: string): string {
  return displayName.trim().split(/\s+/u)[0] ?? '';
}

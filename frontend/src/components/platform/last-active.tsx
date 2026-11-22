import { formatLastActive, formatPlatformDateTime } from './platform-format';

/** Relative last active; the absolute date and time is the title. */
export function LastActive({ value }: { value: string | null }) {
  const text = formatLastActive(value);
  if (value === null) return <>{text}</>;
  return (
    <time
      dateTime={new Date(value).toISOString()}
      title={formatPlatformDateTime(value)}
    >
      {text}
    </time>
  );
}

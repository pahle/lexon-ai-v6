export function safeReturnPath(value: unknown): string {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//')
  )
    return '/workspace';
  let decoded = value;
  for (let index = 0; index < 3; index++) {
    try {
      decoded = decodeURIComponent(decoded);
    } catch {
      return '/workspace';
    }
    if (
      decoded.includes(String.fromCharCode(92)) ||
      [...decoded].some(
        (character) =>
          character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
      ) ||
      decoded.startsWith('//')
    )
      return '/workspace';
  }
  try {
    const url = new URL(value, 'https://lexon.invalid');
    return url.origin === 'https://lexon.invalid'
      ? url.pathname + url.search + url.hash
      : '/workspace';
  } catch {
    return '/workspace';
  }
}

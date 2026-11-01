// Native operations can refresh and then replace the same cookie. A browser
// keeps the final value; replaying both would resolve the deleted session.
export function authResponseCookies(response: Response): Headers | undefined {
  const declared = response.headers.getSetCookie();
  if (!declared.length) return undefined;
  const cookies = new Map<string, string>();
  for (const header of declared) {
    const pair = header.split(';')[0]!;
    const separator = pair.indexOf('=');
    if (separator < 1) continue;
    const name = pair.slice(0, separator);
    if (
      !pair.slice(separator + 1) ||
      /(?:^|;)\s*max-age\s*=\s*(?:0|-\d+)(?:;|$)/i.test(header)
    )
      cookies.delete(name);
    else cookies.set(name, pair);
  }
  return new Headers({ cookie: [...cookies.values()].join('; ') });
}

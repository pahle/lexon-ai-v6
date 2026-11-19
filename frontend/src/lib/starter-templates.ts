export const STARTER_TEMPLATES: readonly {
  readonly label: string;
  readonly template: string;
}[] = [
  {
    label: 'Explain an article',
    template:
      'Explain Article [number] of [law or regulation] in plain language.',
  },
  {
    label: 'Compare two rules',
    template:
      'Compare [first rule] with [second rule] and list the differences that matter in practice.',
  },
  {
    label: 'Check a clause',
    template: 'Check this clause for risks and missing terms: [paste clause]',
  },
  {
    label: 'Summarize a regulation',
    template:
      'Summarize [regulation], including who it applies to and the key obligations.',
  },
];

export type TextRange = { readonly start: number; readonly end: number };

/** The first `[...]` at or after `from`, brackets included. */
export function firstPlaceholderRange(
  text: string,
  from = 0,
): TextRange | null {
  const start = text.indexOf('[', from);
  if (start === -1) return null;
  const close = text.indexOf(']', start + 1);
  if (close === -1) return null;
  return { start, end: close + 1 };
}

export function insertTemplate(
  current: string,
  template: string,
): { text: string; selection: TextRange | null } {
  const prefix = current.trim() === '' ? '' : `${current}\n`;
  return {
    text: prefix + template,
    selection: firstPlaceholderRange(template, 0)
      ? offset(firstPlaceholderRange(template, 0)!, prefix.length)
      : null,
  };
}

function offset(range: TextRange, by: number): TextRange {
  return { start: range.start + by, end: range.end + by };
}

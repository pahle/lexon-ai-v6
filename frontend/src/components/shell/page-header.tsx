import type { ReactNode } from 'react';

export function PageHeader(_props: { title: string; actions?: ReactNode }) {
  const { title, actions } = _props;
  return (
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border pb-4">
      <h1 className="text-2xl font-semibold">{title}</h1>
      {actions ? (
        <div className="flex items-center gap-2">{actions}</div>
      ) : null}
    </header>
  );
}

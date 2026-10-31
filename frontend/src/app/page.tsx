import { connection } from 'next/server';
import { HealthStatus } from '../components/health-status';
import { DiagnosticForm } from '../components/diagnostic-form';
import { createServerFoundationClient } from '../lib/server-foundation-client';
export default async function Page() {
  await connection();
  const initialHealth = await createServerFoundationClient()
    .health()
    .catch(() => undefined);
  return (
    <main
      data-server-version={initialHealth?.version ?? ''}
      className="mx-auto flex min-h-screen max-w-3xl flex-col gap-8 px-6 py-12"
    >
      <header className="flex flex-col gap-2">
        <p className="text-muted-foreground text-sm">LEXON / FOUNDATION</p>
        <h1 className="text-2xl font-semibold">Foundation checks</h1>
        <p className="text-muted-foreground">
          Backend health and request validation.
        </p>
      </header>
      <HealthStatus {...(initialHealth ? { initialHealth } : {})} />
      <DiagnosticForm />
    </main>
  );
}

'use client';
import { useQuery } from '@tanstack/react-query';
import { CircleCheck, Server } from 'lucide-react';
import type { HealthResponse } from '@lexon/contracts';
import { createFoundationClient } from '../lib/foundation-client';
export function HealthStatus({
  initialHealth,
}: {
  initialHealth?: HealthResponse;
}) {
  const query = useQuery({
    queryKey: ['foundation', 'health'],
    queryFn: () => createFoundationClient({ baseUrl: '/api' }).health(),
    ...(initialHealth ? { initialData: initialHealth } : {}),
  });
  const healthy = query.data?.status === 'ok' && !query.isError;
  return (
    <section
      aria-labelledby="backend-status-title"
      className="flex flex-col gap-4"
    >
      <h2 id="backend-status-title" className="flex items-center gap-2">
        <Server className="size-4" aria-hidden />
        Backend status
      </h2>
      <div role="status" aria-live="polite">
        {query.isPending ? (
          'Checking backend…'
        ) : healthy ? (
          <p className="flex items-center gap-2">
            <CircleCheck className="size-4" aria-hidden />
            Backend available
          </p>
        ) : (
          <p>Backend unavailable</p>
        )}
        {query.data && (
          <p className="text-muted-foreground mt-2">
            Backend version {query.data.version}
          </p>
        )}
      </div>
    </section>
  );
}

import { RunStatusSchema, type RunStatus } from '@lexon/contracts';

const transitions: Readonly<Record<RunStatus, readonly RunStatus[]>> = {
  queued: ['running', 'cancelling'],
  running: [
    'running',
    'awaiting_approval',
    'completed',
    'failed',
    'cancelling',
  ],
  awaiting_approval: ['running', 'failed', 'cancelling'],
  completed: [],
  failed: [],
  cancelling: ['cancelled'],
  cancelled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  if (
    !RunStatusSchema.safeParse(from).success ||
    !RunStatusSchema.safeParse(to).success
  )
    return false;
  return transitions[from].includes(to);
}

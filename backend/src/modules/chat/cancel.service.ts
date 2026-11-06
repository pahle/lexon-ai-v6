import type {
  AiRunRepository,
  AiStepRepository,
  RunActorFactsRepository,
  TenantDatabase,
  TerminalStreamReference,
} from '../../infrastructure/db/index.js';
import type { RunStreams } from '../../infrastructure/queue/index.js';
import type { RunActor } from '../identity-access/index.js';
import type { RunAuthorizationService } from '../identity-access/index.js';

export interface CancelSignalPublisher {
  publish(runId: string): Promise<void>;
}

export class CancelService {
  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: AiRunRepository,
    private readonly steps: AiStepRepository,
    private readonly facts: RunActorFactsRepository,
    private readonly authorization: RunAuthorizationService,
    private readonly streams?: RunStreams,
    private readonly signals?: CancelSignalPublisher,
  ) {}

  async cancel(actor: RunActor, runId: string): Promise<void> {
    this.authorization.assertLiveActor(actor);
    let terminalReference: TerminalStreamReference | undefined;
    let shouldSignal = false;
    await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        await this.steps.lockTenantClaimGuard(tx);
        const run = await this.runs.lockForLifecycle(tx, runId);
        if (!run || run.initiatingUserId !== actor.userId)
          throw new Error('AI run cancellation refused');
        const facts = await this.facts.read(tx, {
          orgId: actor.orgId,
          userId: actor.userId,
          runId,
        });
        const policy = facts
          ? await this.authorization.authorize(
              tx,
              facts,
              { profileId: run.profileId, capabilities: [] },
              'cancel',
            )
          : null;
        if (!policy?.allowed) throw new Error('AI run cancellation refused');
        if (['completed', 'failed', 'cancelled'].includes(run.status)) return;

        const current = await this.steps.lockCurrent(tx, {
          runId: run.id,
          sequence: run.nextSequence,
        });
        const activeOwner = Boolean(
          current?.state === 'claimed' &&
          current.leaseUntil &&
          current.leaseUntil.getTime() > Date.now(),
        );
        let version = run.runVersion;
        if (run.status !== 'cancelling') {
          if (
            !(await this.runs.transition(tx, {
              runId,
              expectedVersion: version,
              from: run.status,
              to: 'cancelling',
            }))
          )
            throw new Error('AI run cancellation refused');
          version++;
        }
        shouldSignal = true;
        if (activeOwner) return;
        const partial = await this.runs.latestCheckpointText(
          tx,
          run.id,
          run.nextSequence,
        );
        if (
          !(await this.runs.transition(tx, {
            runId,
            expectedVersion: version,
            from: 'cancelling',
            to: 'cancelled',
            outputAppend: partial,
          }))
        )
          throw new Error('AI run cancellation refused');
        terminalReference = await this.runs.terminalStreamReference(tx, runId);
      },
    );
    if (shouldSignal) await this.signals?.publish(runId).catch(() => undefined);
    if (terminalReference)
      await this.streams?.finish(terminalReference, {
        version: 1,
        runId,
        type: 'finish',
      });
  }
}

import { randomUUID } from 'node:crypto';
import type {
  AiRunRepository,
  AiStepRepository,
  RunActorFactsRepository,
  TenantDatabase,
  StepClaim,
  TerminalStreamReference,
} from '../../infrastructure/db/index.js';
import type { RunStreams } from '../../infrastructure/queue/index.js';
import type { RunActor } from '../identity-access/index.js';
import type { RunAuthorizationService } from '../identity-access/index.js';
import { AuditService } from '../audit/index.js';

export interface CancelSignalPublisher {
  publish(runId: string): Promise<void>;
}

export class CancelService {
  private readonly audit = new AuditService();
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
        const partial = await this.runs.latestCheckpointText(
          tx,
          run.id,
          run.nextSequence,
        );
        if (current?.state === 'claimed') {
          const expiredClaim: StepClaim = {
            runId: run.id,
            orgId: actor.orgId,
            userId: actor.userId,
            stepId: current.id,
            sequence: current.sequence,
            expectedVersion: current.expectedVersion,
            fence: current.fence,
            leaseUntil: current.leaseUntil ?? new Date(0),
          };
          if (
            !(await this.steps.commitExpiredCancellation(
              tx,
              expiredClaim,
              partial,
            ))
          )
            return;
        }
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
        const provider =
          run.resolvedConfig && typeof run.resolvedConfig === 'object'
            ? (run.resolvedConfig as Record<string, unknown>).provider
            : undefined;
        if (typeof provider !== 'string')
          throw new Error('AI run cancellation refused');
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          type: 'chat.run_finished.v1',
          occurredAt: new Date().toISOString(),
          outcome: 'failure',
          orgId: actor.orgId,
          actorUserId: actor.userId,
          metadata: {
            runId,
            model: run.modelId,
            provider,
            status: 'cancelled',
          },
        });
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

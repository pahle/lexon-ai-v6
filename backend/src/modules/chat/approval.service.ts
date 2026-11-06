import type {
  AiOperationRepository,
  AiRunRepository,
  AiStepRepository,
  OutboxRepository,
  RunActorFactsRepository,
  TenantDatabase,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import type { RunAuthorizationService } from '../identity-access/index.js';
import { stepJobId } from './step-job-id.js';
import type { RunRegistry } from './run-registry.js';
import type { RunStreams } from '../../infrastructure/queue/index.js';
import { AuditService } from '../audit/index.js';
import { randomUUID } from 'node:crypto';

export class ApprovalService {
  private readonly audit = new AuditService();
  constructor(
    private readonly database: TenantDatabase,
    private readonly runs: AiRunRepository,
    private readonly steps: AiStepRepository,
    private readonly operations: AiOperationRepository,
    private readonly facts: RunActorFactsRepository,
    private readonly authorization: RunAuthorizationService,
    private readonly outbox: OutboxRepository,
    private readonly registry: RunRegistry,
    private readonly streams?: RunStreams,
  ) {}

  async decide(
    actor: RunActor,
    input: {
      runId: string;
      operationId: string;
      snapshotHash: string;
      decision: 'approve' | 'reject';
    },
  ): Promise<void> {
    this.authorization.assertLiveActor(actor);
    const terminalReference = await this.database.withTenant(
      { orgId: actor.orgId, userId: actor.userId },
      async (tx) => {
        const run = await this.runs.find(tx, input.runId);
        if (
          !run ||
          run.status !== 'awaiting_approval' ||
          run.initiatingUserId !== actor.userId
        )
          throw new Error('AI approval decision refused');
        const facts = await this.facts.read(tx, {
          orgId: actor.orgId,
          userId: actor.userId,
          runId: input.runId,
        });
        const snapshot = asRecord(run.resolvedConfig).profileSnapshot;
        const capabilities = asRecord(snapshot).capabilities;
        const currentProfile = this.registry.profile(run.profileId);
        const currentCapabilities = Array.isArray(capabilities)
          ? capabilities.filter(
              (value): value is string =>
                typeof value === 'string' &&
                Boolean(currentProfile?.capabilities.includes(value)),
            )
          : [];
        const decision =
          facts && currentProfile
            ? await this.authorization.authorize(
                tx,
                facts,
                {
                  profileId: run.profileId,
                  capabilities: currentCapabilities,
                },
                'decision',
              )
            : null;
        if (!decision?.mayDecide) {
          const operation = (
            await this.operations.forRun(tx, {
              runId: input.runId,
              throughSequence: run.nextSequence,
            })
          ).find((candidate) => candidate.id === input.operationId);
          if (!operation) throw new Error('AI approval decision refused');
          const rejected = await this.operations.rejectApprovalForAccessLoss(
            tx,
            {
              runId: input.runId,
              operationId: input.operationId,
              snapshotHash: input.snapshotHash,
              initiatorUserId: run.initiatingUserId,
            },
          );
          if (!rejected) throw new Error('AI approval decision refused');
          if (
            !(await this.runs.transition(tx, {
              runId: run.id,
              expectedVersion: run.runVersion,
              from: 'awaiting_approval',
              to: 'failed',
              errorCode: 'AI_ACCESS_REVOKED',
            }))
          )
            throw new Error('AI approval decision refused');
          const provider = asRecord(run.resolvedConfig).provider;
          if (
            typeof provider !== 'string' ||
            !/^[a-zA-Z0-9._/-]{1,80}$/.test(provider)
          )
            throw new Error('AI approval decision refused');
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.tool_operation.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'failure',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: {
              runId: run.id,
              stepId: operation.stepId,
              operationId: operation.id,
              model: run.modelId,
              provider,
              status: 'failed',
            },
          });
          await this.audit.append(tx, {
            version: 1,
            eventId: randomUUID(),
            type: 'chat.run_finished.v1',
            occurredAt: new Date().toISOString(),
            outcome: 'failure',
            orgId: actor.orgId,
            actorUserId: actor.userId,
            metadata: {
              runId: run.id,
              model: run.modelId,
              provider,
              status: 'failed',
              safeCode: 'AI_ACCESS_REVOKED',
            },
          });
          const reference = await this.runs.terminalStreamReference(tx, run.id);
          if (!reference) throw new Error('AI approval decision refused');
          return reference;
        }
        const operation = await this.operations.decideApproval(tx, {
          ...input,
          userId: actor.userId,
        });
        if (!operation) throw new Error('AI approval decision refused');
        const provider = asRecord(run.resolvedConfig).provider;
        if (
          typeof provider !== 'string' ||
          !/^[a-zA-Z0-9._/-]{1,80}$/.test(provider)
        )
          throw new Error('AI approval decision refused');
        await this.audit.append(tx, {
          version: 1,
          eventId: randomUUID(),
          type: 'chat.approval_decided.v1',
          occurredAt: new Date().toISOString(),
          outcome: 'success',
          orgId: actor.orgId,
          actorUserId: actor.userId,
          metadata: {
            runId: run.id,
            operationId: input.operationId,
            status: input.decision === 'approve' ? 'approved' : 'rejected',
          },
        });
        const sequence = run.nextSequence;
        const expectedVersion = run.runVersion + 1;
        if (
          !(await this.runs.transition(tx, {
            runId: run.id,
            expectedVersion: run.runVersion,
            from: 'awaiting_approval',
            to: 'running',
          }))
        )
          throw new Error('AI approval decision refused');
        await this.steps.insertInitial(tx, {
          id: randomUUID(),
          runId: run.id,
          sequence,
          expectedVersion,
        });
        await this.outbox.append(
          tx,
          {
            type: 'run.resume.v1',
            ctx: { orgId: actor.orgId, userId: actor.userId },
            payload: { runId: run.id, sequence, expectedVersion },
          },
          {
            id: stepJobId(run.id, sequence),
            ...(isRouting(run.resolvedConfig)
              ? {
                  queue: run.resolvedConfig.queue,
                  priority: run.resolvedConfig.priority,
                }
              : {}),
          },
        );
        return null;
      },
    );
    if (terminalReference) {
      await this.streams?.finish(terminalReference, {
        version: 1,
        runId: input.runId,
        type: 'finish',
      });
      throw new Error('AI approval decision refused');
    }
  }
}

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function isRouting(value: unknown): value is Record<string, unknown> & {
  queue: 'ai-interactive' | 'ai-batch';
  priority: number;
} {
  const record = asRecord(value);
  return (
    (record.queue === 'ai-interactive' || record.queue === 'ai-batch') &&
    typeof record.priority === 'number'
  );
}

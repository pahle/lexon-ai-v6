import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
} from '@nestjs/common';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { RUNTIME_CONFIG } from '../../config/config.module.js';
import {
  OperationDecisionInputSchema,
  UuidSchema,
  type OperationDecisionResult,
} from '@lexon/contracts';
import {
  currentVerifiedIdentity,
  IdentityError,
  RunAuthorizationService,
  verifiedIdentityHeaders,
} from '../identity-access/index.js';
import { ApprovalService } from './approval.service.js';

/**
 * §6.3 owner-only decision route. The service resolves chat → run → op in
 * one tenant transaction; non-owners get the identical CHAT_NOT_FOUND a
 * random id gets, and already-decided ops return their stored outcome.
 */
@Controller('runs')
export class OperationsController {
  constructor(
    private readonly approvals: ApprovalService,
    private readonly authorization: RunAuthorizationService,
    @Inject(RUNTIME_CONFIG)
    private readonly config: Extract<RuntimeConfig, { runtime: 'api' }>,
  ) {}

  @Post(':runId/operations/:operationId/decision')
  @HttpCode(HttpStatus.OK)
  decide(
    @Param('runId') runId: string,
    @Param('operationId') operationId: string,
    @Body() value: unknown,
  ): Promise<OperationDecisionResult> {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    const input = OperationDecisionInputSchema.parse(value);
    return this.authorization.withActor(identity, (actor) =>
      this.approvals.decideOperation(
        actor,
        {
          runId: UuidSchema.parse(runId),
          operationId: UuidSchema.parse(operationId),
          snapshotHash: input.snapshotHash,
          decision: input.action,
          ...(input.action === 'answer' ? { answers: input.answers } : {}),
        },
        { requireOwnedChat: true },
      ),
    );
  }

  private assertCookieOrigin(): void {
    const identity = currentVerifiedIdentity();
    if (identity.channel !== 'cookie') return;
    const expectedOrigin = this.config.auth.origin;
    const headers = verifiedIdentityHeaders(identity);
    if (
      headers.get('origin') !== expectedOrigin ||
      headers.get('sec-fetch-site') === 'cross-site'
    )
      throw new IdentityError('VALIDATION_ERROR', 403);
  }
}

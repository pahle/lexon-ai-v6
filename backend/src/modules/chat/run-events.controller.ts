import {
  BadRequestException,
  Controller,
  Get,
  Param,
  Post,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import {
  CHAT_STREAM_RECOVERY_HEADER,
  CHAT_STREAM_RECOVERY_RESULT_HEADER,
  ChatStreamRecoveryModeSchema,
  UuidSchema,
} from '@lexon/contracts';
import {
  currentVerifiedIdentity,
  RunAuthorizationService,
} from '../identity-access/index.js';
import type {
  SseFrame,
  SseSink,
  Subscription,
} from '../../infrastructure/queue/stream-hub.js';
import { RunEventsService } from './run-events.service.js';
import { ChatService } from './chat.service.js';
import { CancelService } from './cancel.service.js';

@Controller('runs')
export class RunEventsController {
  constructor(
    private readonly events: RunEventsService,
    private readonly authorization: RunAuthorizationService,
    private readonly chats: ChatService,
    private readonly cancellation: CancelService,
  ) {}

  @Get(':runId/events')
  async eventsForRun(
    @Param('runId') runId: string,
    @Req() request: Request,
    @Res() response: Response,
  ): Promise<void> {
    const identity = currentVerifiedIdentity();
    let subscription: Subscription | undefined;
    let disconnected = false;
    let resolveDisconnected!: () => void;
    const disconnectedPromise = new Promise<void>((resolve) => {
      resolveDisconnected = resolve;
    });
    const sink: SseSink = {
      setRecoveryMode: (mode) => {
        if (!response.headersSent)
          response.setHeader(CHAT_STREAM_RECOVERY_RESULT_HEADER, mode);
      },
      write: (frame) => {
        if (disconnected || response.destroyed) return false;
        if (!response.headersSent) {
          response.status(200);
          response.setHeader(
            'content-type',
            'text/event-stream; charset=utf-8',
          );
          response.setHeader('cache-control', 'no-cache, no-transform');
          response.setHeader('x-accel-buffering', 'no');
        }
        response.flushHeaders();
        response.write(serializeFrame(frame));
        return !response.writableNeedDrain;
      },
      drain: (timeoutMs) => waitForDrain(response, timeoutMs),
      close: async () => {
        if (!response.writableEnded && !response.destroyed) response.end();
      },
    };
    response.on('close', () => {
      disconnected = true;
      resolveDisconnected();
      void subscription?.close();
    });
    const parsedRunId = UuidSchema.parse(runId);
    const rawRecoveryMode = request.header(CHAT_STREAM_RECOVERY_HEADER);
    const recoveryMode =
      rawRecoveryMode === undefined
        ? 'incremental'
        : ChatStreamRecoveryModeSchema.safeParse(rawRecoveryMode).success
          ? ChatStreamRecoveryModeSchema.parse(rawRecoveryMode)
          : (() => {
              throw new BadRequestException('Invalid stream recovery mode');
            })();
    await this.authorization.withActor(identity, async (actor) => {
      try {
        subscription = await this.events.connect(
          actor,
          parsedRunId,
          request.header('last-event-id') ?? undefined,
          sink,
          identity,
          recoveryMode,
        );
        if (disconnected || response.destroyed || response.writableEnded)
          await subscription.close();
        else await disconnectedPromise;
      } finally {
        await subscription?.close();
      }
    });
  }

  @Post(':runId/cancel')
  cancel(@Param('runId') runId: string) {
    const identity = currentVerifiedIdentity();
    const parsedRunId = UuidSchema.parse(runId);
    return this.authorization.withActor(identity, async (actor) => {
      await this.chats.assertLiveAnswerRun(actor, parsedRunId);
      await this.cancellation.cancel(actor, parsedRunId);
    });
  }
}

function serializeFrame(frame: SseFrame): string {
  if (frame.data.startsWith(':')) return `${frame.data}\n\n`;
  return `${frame.id ? `id: ${frame.id}\n` : ''}data: ${frame.data}\n\n`;
}

function waitForDrain(response: Response, timeoutMs: number): Promise<boolean> {
  if (response.destroyed || response.writableEnded)
    return Promise.resolve(false);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (drained: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      response.off('drain', onDrain);
      response.off('close', onClose);
      resolve(drained);
    };
    const onDrain = () => finish(true);
    const onClose = () => finish(false);
    const timer = setTimeout(() => finish(false), timeoutMs);
    response.once('drain', onDrain);
    response.once('close', onClose);
  });
}

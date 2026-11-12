import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Inject,
  Param,
  Post,
  Put,
  Query,
  Req,
  Res,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { RUNTIME_CONFIG } from '../../config/config.module.js';
import {
  CreateChatInputSchema,
  ChatSearchRequestSchema,
  EditMessageInputSchema,
  RegenerateInputSchema,
  SendMessageInputSchema,
  SetChatFeedbackInputSchema,
  UuidSchema,
  ViewedLeafInputSchema,
} from '@lexon/contracts';
import {
  currentVerifiedIdentity,
  IdentityError,
  RunAuthorizationService,
  verifiedIdentityHeaders,
} from '../identity-access/index.js';
import { ChatService } from './chat.service.js';
import { ChatSearchService } from './chat-search.service.js';
import { ChatFeedbackService } from './chat-feedback.service.js';
import { ChatBranchService } from './chat-branch.service.js';
import { ChatDeletionService } from './chat-deletion.service.js';
import { RunEventsService } from './run-events.service.js';
import type {
  SseFrame,
  SseSink,
  Subscription,
} from '../../infrastructure/queue/stream-hub.js';

@Controller('chats')
export class ChatController {
  constructor(
    private readonly chats: ChatService,
    private readonly authorization: RunAuthorizationService,
    private readonly branches: ChatBranchService,
    private readonly deletion: ChatDeletionService,
    private readonly events: RunEventsService,
    private readonly search: ChatSearchService,
    private readonly feedback: ChatFeedbackService,
    @Inject(RUNTIME_CONFIG)
    private readonly config: Extract<RuntimeConfig, { runtime: 'api' }>,
  ) {}

  @Get('events')
  async chatEvents(
    @Req() _request: Request,
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
        response.write(serializeEventFrame(frame));
        return !response.writableNeedDrain;
      },
      drain: (timeoutMs) => waitForEventDrain(response, timeoutMs),
      close: async () => {
        if (!response.writableEnded && !response.destroyed) response.end();
      },
    };
    response.on('close', () => {
      disconnected = true;
      resolveDisconnected();
      void subscription?.close();
    });
    await this.authorization.withActor(identity, async (actor) => {
      try {
        subscription = await this.events.connectChatInvalidations(
          actor,
          sink,
          identity,
        );
        if (disconnected || response.destroyed || response.writableEnded)
          await subscription.close();
        else await disconnectedPromise;
      } finally {
        await subscription?.close();
      }
    });
  }

  @Post()
  create(@Body() value: unknown) {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.chats.create(actor, CreateChatInputSchema.parse(value)),
    );
  }

  @Get()
  list(@Query() query: unknown) {
    const identity = currentVerifiedIdentity();
    const input = z
      .strictObject({
        cursor: z.string().min(1).max(256).optional(),
        limit: z
          .string()
          .regex(/^[0-9]{1,3}$/)
          .transform(Number)
          .pipe(z.number().int().min(1).max(100))
          .optional(),
      })
      .parse(query);
    return this.authorization.withActor(identity, (actor) =>
      this.chats.list(actor, {
        ...(input.cursor === undefined ? {} : { cursor: input.cursor }),
        ...(input.limit === undefined ? {} : { limit: input.limit }),
      }),
    );
  }

  @Post('search')
  @HttpCode(HttpStatus.OK)
  searchChats(@Body() value: unknown) {
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.search.search(actor, ChatSearchRequestSchema.parse(value)),
    );
  }

  @Post(':chatId/search-match/:messageId')
  resolveSearchMatch(
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
  ) {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.chats.resolveSearchMatch(
        actor,
        UuidSchema.parse(chatId),
        UuidSchema.parse(messageId),
      ),
    );
  }

  @Get(':chatId')
  get(@Param('chatId') chatId: string) {
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.chats.get(actor, UuidSchema.parse(chatId)),
    );
  }

  @Delete(':chatId')
  @HttpCode(HttpStatus.NO_CONTENT)
  delete(@Param('chatId') chatId: string): Promise<void> {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.deletion.request(actor, UuidSchema.parse(chatId)),
    );
  }

  @Post(':chatId/messages')
  send(@Param('chatId') chatId: string, @Body() value: unknown) {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.chats.send(
        actor,
        UuidSchema.parse(chatId),
        SendMessageInputSchema.parse(value),
      ),
    );
  }

  @Post(':chatId/messages/:messageId/edit')
  edit(
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
    @Body() value: unknown,
  ) {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.branches.edit(
        actor,
        UuidSchema.parse(chatId),
        UuidSchema.parse(messageId),
        EditMessageInputSchema.parse(value),
      ),
    );
  }

  @Post(':chatId/messages/:messageId/regenerate')
  regenerate(
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
    @Body() value: unknown,
  ) {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.branches.regenerate(
        actor,
        UuidSchema.parse(chatId),
        UuidSchema.parse(messageId),
        RegenerateInputSchema.parse(value),
      ),
    );
  }

  @Put(':chatId/messages/:messageId/feedback')
  @HttpCode(HttpStatus.NO_CONTENT)
  setFeedback(
    @Param('chatId') chatId: string,
    @Param('messageId') messageId: string,
    @Body() value: unknown,
  ): Promise<void> {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    const input = SetChatFeedbackInputSchema.parse(value);
    return this.authorization.withActor(identity, (actor) =>
      this.feedback.set(
        actor,
        UuidSchema.parse(chatId),
        UuidSchema.parse(messageId),
        input.rating,
      ),
    );
  }

  @Put(':chatId/viewed-leaf')
  selectLeaf(@Param('chatId') chatId: string, @Body() value: unknown) {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.branches.selectLeaf(
        actor,
        UuidSchema.parse(chatId),
        ViewedLeafInputSchema.parse(value).leafId,
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

function serializeEventFrame(frame: SseFrame): string {
  if (frame.data.startsWith(':')) return `${frame.data}\n\n`;
  return `${frame.id ? `id: ${frame.id}\n` : ''}data: ${frame.data}\n\n`;
}

function waitForEventDrain(
  response: Response,
  timeoutMs: number,
): Promise<boolean> {
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
    if (response.destroyed || response.writableEnded) finish(false);
  });
}

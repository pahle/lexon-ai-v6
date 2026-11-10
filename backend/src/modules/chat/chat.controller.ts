import { Body, Controller, Get, Inject, Param, Post } from '@nestjs/common';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { RUNTIME_CONFIG } from '../../config/config.module.js';
import {
  CreateChatInputSchema,
  SendMessageInputSchema,
  UuidSchema,
} from '@lexon/contracts';
import {
  currentVerifiedIdentity,
  IdentityError,
  RunAuthorizationService,
  verifiedIdentityHeaders,
} from '../identity-access/index.js';
import { ChatService } from './chat.service.js';

@Controller('chats')
export class ChatController {
  constructor(
    private readonly chats: ChatService,
    private readonly authorization: RunAuthorizationService,
    @Inject(RUNTIME_CONFIG)
    private readonly config: Extract<RuntimeConfig, { runtime: 'api' }>,
  ) {}

  @Post()
  create(@Body() value: unknown) {
    this.assertCookieOrigin();
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.chats.create(actor, CreateChatInputSchema.parse(value)),
    );
  }

  @Get(':chatId')
  get(@Param('chatId') chatId: string) {
    const identity = currentVerifiedIdentity();
    return this.authorization.withActor(identity, (actor) =>
      this.chats.get(actor, UuidSchema.parse(chatId)),
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

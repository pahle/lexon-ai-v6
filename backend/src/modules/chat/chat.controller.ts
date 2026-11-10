import {
  Body,
  Controller,
  Get,
  Inject,
  Param,
  Post,
  Put,
} from '@nestjs/common';
import type { RuntimeConfig } from '../../config/runtime-config.js';
import { RUNTIME_CONFIG } from '../../config/config.module.js';
import {
  CreateChatInputSchema,
  EditMessageInputSchema,
  RegenerateInputSchema,
  SendMessageInputSchema,
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
import { ChatBranchService } from './chat-branch.service.js';

@Controller('chats')
export class ChatController {
  constructor(
    private readonly chats: ChatService,
    private readonly authorization: RunAuthorizationService,
    private readonly branches: ChatBranchService,
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

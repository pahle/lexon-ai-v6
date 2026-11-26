import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import {
  currentTenantContext,
  currentVerifiedIdentity,
} from '../identity-access/index.js';
import { ChatSharesService } from './chat-shares.service.js';

/** No TenantGuard allowance needed on any of these routes: the POST body key
 * is `userIds` (plural) and DELETE takes the recipient as a path param, so
 * the guard's `userId` override check never fires (F6 §7 inventory). */
@Controller('chats')
export class ChatSharesController {
  constructor(private readonly shares: ChatSharesService) {}

  @Get(':chatId/shares') list(@Param('chatId') chatId: string) {
    return this.shares.list(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(chatId),
    );
  }

  @Post(':chatId/shares')
  add(@Param('chatId') chatId: string, @Body() input: unknown) {
    return this.shares.add(
      currentTenantContext(),
      currentVerifiedIdentity(),
      UuidSchema.parse(chatId),
      input,
    );
  }

  @Delete(':chatId/shares/:userId')
  @HttpCode(204)
  revoke(@Param('chatId') chatId: string, @Param('userId') userId: string) {
    return this.shares.revoke(
      currentTenantContext(),
      UuidSchema.parse(chatId),
      UuidSchema.parse(userId),
    );
  }
}

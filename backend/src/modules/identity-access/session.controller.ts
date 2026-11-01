import {
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Param,
  Post,
} from '@nestjs/common';
import { UuidSchema } from '@lexon/contracts';
import { AccountRoute } from './route-access.js';
import { currentVerifiedIdentity } from './identity.types.js';
import { SessionService } from './session.service.js';
@Controller('identity')
@AccountRoute()
export class SessionController {
  constructor(private readonly sessions: SessionService) {}
  @Post('bearer-sessions')
  @Header('Cache-Control', 'no-store')
  @Header('Referrer-Policy', 'no-referrer')
  issue() {
    return this.sessions.issueBearer(currentVerifiedIdentity());
  }
  @Get('sessions') @Header('Cache-Control', 'no-store') list() {
    return this.sessions.list(currentVerifiedIdentity());
  }
  @Delete('sessions/:sessionId') @HttpCode(204) revoke(
    @Param('sessionId') sessionId: string,
  ) {
    return this.sessions.revoke(
      currentVerifiedIdentity(),
      UuidSchema.parse(sessionId),
    );
  }
}

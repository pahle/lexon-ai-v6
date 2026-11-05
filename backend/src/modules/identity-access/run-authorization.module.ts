import { Module } from '@nestjs/common';
import { RunAuthorizationService } from './run-authorization.service.js';

@Module({
  providers: [RunAuthorizationService],
  exports: [RunAuthorizationService],
})
export class RunAuthorizationModule {}

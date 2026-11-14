import { Module } from '@nestjs/common';
import { AttemptService } from './attempt.service.js';
import { UsageEventsService } from './usage-events.service.js';

@Module({
  providers: [AttemptService, UsageEventsService],
  exports: [AttemptService, UsageEventsService],
})
export class UsageModule {}

import { Module } from '@nestjs/common';
import { AttemptService } from './attempt.service.js';

@Module({ providers: [AttemptService], exports: [AttemptService] })
export class UsageModule {}

import { Module } from '@nestjs/common';
import { PlatformModule } from '../modules/platform/index.js';
@Module({ imports: [PlatformModule] })
export class EvaluationModule {}

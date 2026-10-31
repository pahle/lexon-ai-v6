import { Module } from '@nestjs/common';
import { PlatformVersionService } from './version.service.js';
@Module({
  providers: [PlatformVersionService],
  exports: [PlatformVersionService],
})
export class PlatformModule {}

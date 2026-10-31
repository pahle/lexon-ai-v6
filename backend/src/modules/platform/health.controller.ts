import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import type { HealthResponse } from '@lexon/contracts';
import { HealthIndicators } from '../../infrastructure/telemetry/index.js';
import { PlatformVersionService } from './version.service.js';
@Controller('health')
export class HealthController {
  constructor(
    private readonly indicators: HealthIndicators,
    private readonly version: PlatformVersionService,
  ) {}
  @Get()
  async ready(
    @Res({ passthrough: true }) response: Response,
  ): Promise<HealthResponse> {
    const dependencies = await this.indicators.check('api');
    const ready = Object.values(dependencies).every((value) => value === 'up');
    response.status(ready ? 200 : 503);
    return {
      status: ready ? 'ok' : 'unavailable',
      version: this.version.version,
      dependencies,
    };
  }
  @Get('live')
  live() {
    return { status: 'ok' };
  }
}

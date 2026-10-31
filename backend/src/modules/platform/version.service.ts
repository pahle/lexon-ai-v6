import { readFileSync } from 'node:fs';
import { Injectable } from '@nestjs/common';
@Injectable()
export class PlatformVersionService {
  readonly version: string;
  constructor() {
    const manifest = JSON.parse(
      readFileSync(new URL(import.meta.resolve('#backend-package')), 'utf8'),
    ) as { version: string };
    this.version = manifest.version;
  }
}

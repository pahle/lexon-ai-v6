import { Injectable } from '@nestjs/common';
import { readBackendVersion } from '../../config/package-version.js';
@Injectable()
export class PlatformVersionService {
  readonly version = readBackendVersion();
}

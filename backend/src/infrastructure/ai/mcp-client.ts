import { Client } from '@modelcontextprotocol/client';
import { PlatformVersionService } from '../../modules/platform/index.js';
export function createMcpClient(): Client {
  return new Client(
    { name: 'lexon', version: new PlatformVersionService().version },
    { versionNegotiation: { mode: 'auto' } },
  );
}

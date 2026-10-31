import { Client } from '@modelcontextprotocol/client';
import { readBackendVersion } from '../../config/package-version.js';
export function createMcpClient(): Client {
  return new Client(
    { name: 'lexon', version: readBackendVersion() },
    { versionNegotiation: { mode: 'auto' } },
  );
}

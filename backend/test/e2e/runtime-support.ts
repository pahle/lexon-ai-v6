import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
export interface E2EDescriptor {
  project: string;
  apiUrl: string;
  frontendUrl: string;
}
export function descriptor(): E2EDescriptor {
  const input = process.env.LEXON_E2E_DESCRIPTOR;
  if (!input) throw new Error('Run pnpm test:e2e to start an isolated stack');
  const value = JSON.parse(input) as E2EDescriptor;
  if (!/^lexon-e2e-[a-f0-9]+$/.test(value.project))
    throw new Error('Invalid E2E project');
  return value;
}
export async function docker(args: string[]): Promise<string> {
  return (
    await promisify(execFile)('docker', args, {
      timeout: 30000,
      maxBuffer: 16 * 1024 * 1024,
    })
  ).stdout.trim();
}
export async function containerId(service: string): Promise<string> {
  const id = await docker([
    'ps',
    '-a',
    '--filter',
    `label=com.docker.compose.project=${descriptor().project}`,
    '--filter',
    `label=com.docker.compose.service=${service}`,
    '--format',
    '{{.ID}}',
  ]);
  if (!/^[a-f0-9]+$/.test(id))
    throw new Error('Missing or ambiguous E2E service');
  return id;
}

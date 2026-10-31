import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { ModelAllowlistSchema } from './model-allowlist.js';
import { createMcpClient } from './mcp-client.js';
import { createOpenRouterProvider } from './openrouter-provider.js';
const MODEL_ALLOWLIST = Symbol('ModelAllowlist');
const MCP_CLIENT = Symbol('McpClient');
const OPENROUTER_PROVIDER = Symbol('OpenRouterProvider');
@Module({
  providers: [
    {
      provide: MODEL_ALLOWLIST,
      useFactory: () => {
        try {
          return ModelAllowlistSchema.parse(
            JSON.parse(
              readFileSync(
                new URL(
                  '../../../config/model-allowlist.json',
                  import.meta.url,
                ),
                'utf8',
              ),
            ),
          );
        } catch {
          throw new Error('Invalid model allowlist');
        }
      },
    },
    { provide: MCP_CLIENT, useFactory: createMcpClient },
    {
      provide: OPENROUTER_PROVIDER,
      useFactory: () => createOpenRouterProvider(),
    },
  ],
})
export class AiInfrastructureModule {}

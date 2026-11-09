import { readFileSync } from 'node:fs';
import { Module } from '@nestjs/common';
import { ModelAllowlistSchema } from './model-allowlist.js';
import { createMcpClient } from './mcp-client.js';
import { createOpenRouterProvider } from './openrouter-provider.js';
import { createRealModelGateway } from './model-gateway.js';
const MODEL_ALLOWLIST = Symbol('ModelAllowlist');
const MCP_CLIENT = Symbol('McpClient');
const OPENROUTER_PROVIDER = Symbol('OpenRouterProvider');
export const MODEL_GATEWAY = Symbol('ModelGateway');
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
    {
      provide: MODEL_GATEWAY,
      inject: [MODEL_ALLOWLIST],
      useFactory: (allowlist: unknown) =>
        createRealModelGateway({
          allowlist,
          key: process.env.OPENROUTER_API_KEY,
          attestation: process.env.LEXON_OPENROUTER_ZDR_ONLY_VERIFIED,
        }),
    },
  ],
  exports: [MODEL_GATEWAY],
})
export class AiInfrastructureModule {}

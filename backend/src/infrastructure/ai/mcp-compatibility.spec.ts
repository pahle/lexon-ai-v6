import { expect, it, vi } from 'vitest';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/client';
import { createMcpHandler, McpServer } from '@modelcontextprotocol/server';
import { z } from 'zod';
import { createMcpClient } from './mcp-client.js';

it('negotiates MCP v2 2026-07-28 and calls a tool through an in-process HTTP handler', async () => {
  const external = vi
    .spyOn(globalThis, 'fetch')
    .mockRejectedValue(new Error('Unexpected network'));
  const handler = createMcpHandler(() => {
    const server = new McpServer({
      name: 'lexon-test-server',
      version: '1.0.0',
    });
    server.registerTool(
      'echo-probe',
      {
        inputSchema: z.object({ probe: z.string() }),
        outputSchema: z.object({ accepted: z.boolean() }),
      },
      async () => ({
        content: [{ type: 'text', text: 'Accepted' }],
        structuredContent: { accepted: true },
      }),
    );
    return server;
  });
  const inProcess = vi.fn<typeof fetch>((input, init) =>
    handler.fetch(new Request(input, init)),
  );
  const transport = new StreamableHTTPClientTransport(
    new URL('http://test.local/mcp'),
    { fetch: inProcess },
  );
  const client = createMcpClient();
  try {
    await client.connect(transport);
    expect(client.getNegotiatedProtocolVersion()).toBe('2026-07-28');
    expect((await client.listTools()).tools.map((tool) => tool.name)).toContain(
      'echo-probe',
    );
    expect(
      (
        await client.callTool({
          name: 'echo-probe',
          arguments: { probe: 'fixture' },
        })
      ).structuredContent,
    ).toEqual({ accepted: true });
    expect(inProcess).toHaveBeenCalled();
    expect(external).not.toHaveBeenCalled();
  } finally {
    await client.close();
    await handler.close();
    external.mockRestore();
  }
});

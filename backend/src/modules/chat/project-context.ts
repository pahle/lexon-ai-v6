import { Injectable } from '@nestjs/common';
import {
  TenantDatabase,
  requireSession,
} from '../../infrastructure/db/index.js';
import type { RunActor } from '../identity-access/index.js';
import { CHAT_PROFILES, PROJECT_CONTEXT_ID } from './chat-profiles.js';
import type { ContextPiece, ContextProvider } from './run-contracts.js';

/**
 * F6 §9: emits the bound project's name and instructions as UNTRUSTED
 * context pieces — the executor's renderContexts fences every piece, so the
 * instructions can never grant tools, change the model, or affect
 * approvals. The read runs under the initiator's claim through the normal
 * RLS policies; an owner denied on the project fails the capability gate
 * before collect is ever reached, and a standalone run resolves no project
 * row and simply emits nothing.
 */
@Injectable()
export class ProjectContextProvider implements ContextProvider {
  readonly id = PROJECT_CONTEXT_ID;
  readonly version = 1;

  constructor(private readonly database: TenantDatabase) {}

  async collect(args: {
    readonly actor: RunActor;
    readonly runId: string;
    readonly input: Readonly<Record<string, unknown>>;
    readonly budget: number;
  }): Promise<ContextPiece[]> {
    if (
      args.budget !== CHAT_PROFILES['project-chat'].contextBudgets[this.id] ||
      typeof args.input.prompt !== 'string' ||
      !args.input.prompt.trim()
    )
      throw new Error('AI context request denied');
    const row = await this.database.withTenant(
      { orgId: args.actor.orgId, userId: args.actor.userId },
      async (tx) => {
        const { client, ctx } = requireSession(tx);
        const result = await client.query<{
          name: string;
          instructions: string | null;
        }>(
          `SELECT p.name, i.text AS instructions
           FROM app.ai_runs r
           JOIN app.chats c ON c.org_id=r.org_id
             AND c.id::text=r.resolved_config->'resourceIds'->>0
           JOIN app.projects p ON p.org_id=c.org_id AND p.id=c.project_id
           LEFT JOIN app.project_instructions i
             ON i.org_id=p.org_id AND i.project_id=p.id
           WHERE r.org_id=$1 AND r.id=$2`,
          [ctx.orgId, args.runId],
        );
        return result.rows[0];
      },
    );
    if (!row) return [];
    let text = `Project: ${row.name}`;
    if (row.instructions?.trim())
      text += `\n\nProject instructions:\n${row.instructions}`;
    // One bounded piece: shrink the instructions tail rather than the name
    // when the serialized piece would exceed the profile's budget.
    while (
      text.length > 0 &&
      Buffer.byteLength(JSON.stringify([{ label: 'project', text }])) >
        args.budget
    )
      text = text.slice(0, Math.floor(text.length / 2));
    if (!text) return [];
    return [{ label: 'project', text }];
  }
}
